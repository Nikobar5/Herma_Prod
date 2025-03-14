from langchain_ollama import ChatOllama
# Remove ChatMessageHistory import since we don't need it anymore
# from langchain_community.chat_message_histories import ChatMessageHistory
# Remove RunnableWithMessageHistory as we're handling history differently
# from langchain_core.runnables.history import RunnableWithMessageHistory

from prompt_maker import make_prompt
from langchain.globals import set_debug
import logging
from uploaded_data import Uploaded_data
from rag_querying import query_rag
import glob
import os
import time
from pathlib import Path
from count_tokens import estimate_tokens
import re


class Session:
    def __init__(self, currently_used_data):
        set_debug(True)
        self.session_summary = ""
        # Initialize session_history as an empty string
        self.session_history = ""
        self.num_exchanges = 0
        # List of uploaded_data that is being used
        self.currently_used_data = currently_used_data
        self._cancel_generation = False
        self.ltm_session_history = None

        try:
            # Get the project root
            project_root = Path(__file__).resolve().parents[2]
            storage_dir = project_root / 'storage' / 'chat_history_storage'

            # Check if the directory exists before trying to clean it
            if os.path.exists(storage_dir):
                # Find all chat history files in the directory
                old_files = glob.glob(str(storage_dir / "chat_history_*.txt"))

                # Delete each file and its associated vector DB
                for old_file in old_files:
                    # Extract the base filename without extension
                    base_name = os.path.basename(old_file)

                    # Delete the file
                    os.remove(old_file)
                    print(f"DEBUG: Deleted old history file during session initialization: {old_file}")

                    # Delete associated vector DB
                    Uploaded_data.delete_vector_db(base_name)
                    print(f"DEBUG: Deleted vector DB for: {base_name}")

                print(f"DEBUG: Cleared {len(old_files)} files from chat history storage")

                # We've already deleted all vector DBs associated with chat history files
            else:
                # Create the directory if it doesn't exist
                os.makedirs(storage_dir, exist_ok=True)
                print(f"DEBUG: Created chat history storage directory")

        except Exception as e:
            print(f"DEBUG: Error cleaning up chat history storage during initialization: {e}")

    # Add user message to history
    def add_user_message(self, message):
        self.session_history += f"<|start_header_id|>user<|end_header_id|>\n\n{message}<|eot_id|>"

    # Add assistant message to history
    def add_assistant_message(self, message):
        self.session_history += f"<|start_header_id|>assistant<|end_header_id|>\n{message}<|eot_id|>"

    # Takes user input and prints response, using Llama format
    def ask(self, input):
        """
        Takes user input and streams response using Llama prompt format
        """
        self._cancel_generation = False
        # Instantiates the llm to be used, setting the model and context window, other params can also be adjusted
        llm = ChatOllama(model="llama3.2:1b", num_ctx=4000, temperature=0.6, repeat_penalty=1.2)
        # Get context from all uploaded files selected
        doc_context = None
        formatted_sources = None
        if self.currently_used_data != []:
            doc_context = ""
            source_filenames = []

            # Collect results from all databases
            all_results = []
            for data in self.currently_used_data:
                # Query the vector database and collect results with their scores
                results = query_rag(input, data.vector_database_path, 3)

                # Add document name to metadata for each result
                for doc, score in results:
                    doc.metadata["document_name"] = data.name
                    all_results.append((doc, score))

            # Sort all results by score (lower is better in similarity search)
            all_results.sort(key=lambda x: x[1])

            # Take the top 5 results overall
            top_results = all_results[:5]

            # Create context text from top results
            if top_results:
                context_pieces = []
                for doc, score in top_results:
                    # Add doc name prefix to each chunk
                    doc_name = doc.metadata.get("document_name", "Unknown")
                    context_piece = f"From document '{doc_name}':\n{doc.page_content}"
                    context_pieces.append(context_piece)

                    # Add to source filenames for citation
                    source = doc.metadata.get("id", "").split("/")[-1]
                    file_parts = source.split(" Page: ")
                    filename = file_parts[0]

                    # Extract page and section if available
                    page = "-"
                    section = "-"
                    if len(file_parts) > 1 and ":" in file_parts[1]:
                        page_section = file_parts[1].split(":")
                        page = page_section[0]
                        section = page_section[1] if len(page_section) > 1 else "-"

                    source_filenames.append((filename, page, section))

                # Join all context pieces
                doc_context = "\n\n---\n\n".join(context_pieces)

            # Create markdown table of sources
            markdown_table = "\n\n**Sources**\n\n| Filename | Page | Section |\n| -------- | ---- | ------- |\n"
            for filename, page, section in source_filenames:
                markdown_table += f"| {filename} | {page} | {section} |\n"

            formatted_sources = markdown_table

        chat_history_context = ""
        if self.ltm_session_history is not None:
            chat_history_context = "This conversation has been going on for a while, here is some relevant context from " \
                                   "earlier in the conversation that you no longer remember: "

            # Get results from the RAG query
            history_results = query_rag(input, self.ltm_session_history.vector_database_path, 3)

            # Extract and format content from the results
            if history_results:
                history_pieces = []
                for doc, score in history_results:
                    history_pieces.append(doc.page_content)

                # Join the extracted content
                chat_history_context += "\n\n".join(history_pieces)
            else:
                chat_history_context += "No relevant earlier context found."

        # Get the prompt template
        prompt_template = make_prompt(chat_history_context, doc_context, self.currently_used_data)

        # Complete the prompt by filling in the template
        complete_prompt = prompt_template.format(
            chat_history=self.session_history,
            input=input
        )

        # Stream the model's response
        content_yielded = False
        accumulated_response = ""  # Track the accumulated response
        was_interrupted = False  # Flag to track if interruption happened

        try:
            # Send the complete prompt to the model
            for chunk in llm.stream(complete_prompt):
                if self._cancel_generation:
                    was_interrupted = True
                    break  # Exit the loop but continue to our handler below

                # Clean up any response formatting tokens that might be included
                chunk_content = chunk.content
                # Remove any potential leading Llama tokens that might be included in the response
                chunk_content = re.sub(r'^<\|start_header_id\|>assistant<\|end_header_id\|>\s*', '', chunk_content)
                chunk_content = re.sub(r'<\|eot_id\|>$', '', chunk_content)

                content_yielded = True
                accumulated_response += chunk_content  # Build up the full response
                yield chunk_content

            # After streaming finishes (or is interrupted), update the chat history
            if content_yielded:
                # Add the user message to history
                self.add_user_message(input)

                # Add the AI response to history
                if was_interrupted:
                    ai_response = accumulated_response + " [User interrupted response]"
                else:
                    ai_response = accumulated_response

                self.add_assistant_message(ai_response)

        except Exception as e:
            print(f"Error during streaming: {e}")
            if content_yielded:
                # Handle interruptions caused by errors
                self.add_user_message(input)
                self.add_assistant_message(accumulated_response + " [Response interrupted due to error]")

        # Sources handling for normal completion
        if not was_interrupted and formatted_sources is not None and content_yielded:
            yield formatted_sources

        self.num_exchanges += 1
        self.trim_chat_history()

    def cancel_generation(self):
        """Called to stop ongoing generation"""
        self._cancel_generation = True
        print("Generation cancellation requested")

    # Assigns a short summary to a session
    def assign_session_summary(self):
        llm = ChatOllama(model="llama3.2:1b")

        # Create a Llama-formatted prompt for summary generation
        summary_prompt = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>

        Output a sub 5 word short summary blurb of what the topic of this conversation is.<|eot_id|><|start_header_id|>user<|end_header_id|>

        Conversation to summarize:
        {self.get_history_as_string()}<|eot_id|>"""

        response = llm.invoke(summary_prompt)

        # Clean the response of any potential Llama formatting tokens
        cleaned_response = re.sub(r'^<\|start_header_id\|>assistant<\|end_header_id\|>\s*', '', response.content)
        cleaned_response = re.sub(r'<\|eot_id\|>$', '', cleaned_response)

        self.session_summary = cleaned_response.strip()
        print(self.session_summary)

    def get_history_as_string(self):
        """
        Convert the formatted history to a plain string format for display or processing
        """
        # Define a pattern to match user and assistant messages
        pattern = r'<\|start_header_id\|>(user|assistant)<\|end_header_id\|>\s*(.*?)<\|eot_id\|>'

        # Find all matches in the session history
        matches = re.findall(pattern, self.session_history, re.DOTALL)

        # Build a readable string
        history_string = ""
        for role, content in matches:
            prefix = "User: " if role == "user" else "Assistant: "
            history_string += f"{prefix}{content.strip()}\n"

        return history_string

    def trim_chat_history(self):
        """
        Trims the chat history if it exceeds character limit.
        For the string-based history, we need to find and remove complete message blocks.
        """
        # Get readable history to check length
        history_string = self.get_history_as_string()
        total_length = len(history_string)

        # Debug print to verify the actual length
        print(f"DEBUG: Current history length: {total_length} characters")

        # If under the limit, no need to trim
        if total_length <= 4000:
            print(f"DEBUG: History under character limit, no trimming needed.")
            return

        # Find all message blocks in the history
        pattern = r'(<\|start_header_id\|>(user|assistant)<\|end_header_id\|>.*?<\|eot_id\|>)'
        message_blocks = re.findall(pattern, self.session_history, re.DOTALL)

        if not message_blocks:
            print(f"DEBUG: No message blocks found for trimming.")
            return


        # Keep track of blocks to keep and blocks to remove
        blocks_to_keep = []
        current_length = 0

        # Process from newest (end) to oldest (beginning)
        for block_tuple in reversed(message_blocks):
            block = block_tuple[0]  # Get the full message block

            # Extract the content to estimate its plain text length
            content_match = re.search(r'<\|end_header_id\|>\s*(.*?)<\|eot_id\|>', block, re.DOTALL)
            if content_match:
                content = content_match.group(1)
                role = "User: " if "user" in block else "Assistant: "
                plain_length = len(f"{role}{content.strip()}\n")

                # If adding this block would exceed the limit, stop here
                if current_length + plain_length > 4000:
                    break

                # This block fits, so keep it
                blocks_to_keep.insert(0, block)  # Insert at beginning to restore original order
                current_length += plain_length

        # If we're keeping all blocks, no need to trim
        if len(blocks_to_keep) == len(message_blocks):
            print(f"DEBUG: Calculated to keep all messages, something unexpected happened.")
            return

        # Join the blocks to keep into a new history string
        new_history = "".join(blocks_to_keep)

        # Extract the clipped blocks into a string for storing
        removed_blocks = []
        for block_tuple in message_blocks:
            block = block_tuple[0]
            if block not in blocks_to_keep:
                removed_blocks.append(block)

        clipped_history = ""
        for block in removed_blocks:
            content_match = re.search(r'<\|end_header_id\|>\s*(.*?)<\|eot_id\|>', block, re.DOTALL)
            if content_match:
                content = content_match.group(1)
                role = "User: " if "user" in block else "Assistant: "
                clipped_history += f"{role}{content.strip()}\n"

        # Debug print
        print(f"DEBUG: Keeping {len(blocks_to_keep)} most recent messages ({current_length} chars)")
        print(f"DEBUG: Clipping {len(removed_blocks)} messages")

        # Replace the old history with the new one
        self.session_history = new_history

        # Store the clipped history to a file and create Uploaded_data
        if clipped_history:
            # Create the storage directory if it doesn't exist
            project_root = Path(__file__).resolve().parents[2]
            storage_dir = project_root / 'storage' / 'chat_history_storage'
            os.makedirs(storage_dir, exist_ok=True)

            # Get existing history content if available
            existing_content = ""
            if self.ltm_session_history is not None and hasattr(self.ltm_session_history, 'data_path'):
                try:
                    with open(self.ltm_session_history.data_path, 'r', encoding='utf-8') as f:
                        existing_content = f.read()
                except (FileNotFoundError, AttributeError):
                    print(f"DEBUG: Could not read previous history file")
                    pass

            # Clean up old files after retrieving their content
            try:
                # Find all chat history files in the directory
                old_files = glob.glob(str(storage_dir / "chat_history_*.txt"))

                # Delete each one and its associated vector DB
                for old_file in old_files:
                    # Extract the base filename without extension
                    base_name = os.path.basename(old_file)

                    # Delete the file
                    os.remove(old_file)
                    print(f"DEBUG: Deleted old history file: {old_file}")

                    # Delete associated vector DB
                    Uploaded_data.delete_vector_db(base_name)
                    print(f"DEBUG: Deleted vector DB for: {base_name}")
            except Exception as e:
                print(f"DEBUG: Error cleaning up old history files: {e}")

            # Create a filename using timestamp
            timestamp = int(time.time() * 1000)  # millisecond precision
            history_filename = f"chat_history_{timestamp}.txt"
            history_filepath = storage_dir / history_filename

            # Write combined history to the new file
            with open(history_filepath, 'w', encoding='utf-8') as f:
                f.write(existing_content + clipped_history)

            # Debug print
            print(f"DEBUG: Wrote {len(existing_content) + len(clipped_history)} chars to {history_filename}")

            # Create or update the Uploaded_data object with the path to this file
            self.ltm_session_history = Uploaded_data(history_filename, str(history_filepath), False, 200)

        print(f"Chat history trimmed: {len(removed_blocks)} messages clipped, {len(blocks_to_keep)} messages kept")