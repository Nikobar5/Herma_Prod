from langchain_ollama import ChatOllama
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

from prompt_maker import make_prompt
from langchain.globals import set_debug
import logging
from uploaded_data import Uploaded_data
from rag_querying import query_rag
from count_tokens import estimate_tokens

# Session class represents a chat session, session_id can be used for ordering/organizing chat history,
# session.summary can be used to easily retrieve and redisplay chat history, and session_summary can give it a name
# later updates can include metadata like time if possible along with where cutoffs for context ended and other metrics
# to more effectively sort sessions and provide expedited responses
# also makes it easier to manage all storage in one centralized area instead of within the class


class Session:
    def __init__(self, currently_used_data):
        set_debug(True)
        self.session_summary = ""
        self.session_history = ""
        self.num_exchanges = 0
        # List of uploaded_data that is being used
        self.currently_used_data = currently_used_data
        self._cancel_generation = False
        self.ltm_session_history = None

    # Retrieves chat history from whatever session you are in or creates a new session chat history
    def get_chat_history(self):
        if self.session_history == "":
            self.session_history = ChatMessageHistory()
        return self.session_history

    # Takes user input and prints response, langchain handles conversation history
    def ask(self, input):
        """
        Takes user input and streams response, langchain handles conversation history
        """
        self._cancel_generation = False
        # Instantiates the llm to be used, setting the model and context window, other params can also be adjusted
        llm = ChatOllama(model="llama3.2:1b", num_ctx=5000)
        # Get context from all uploaded files selected
        context = None
        formatted_sources = None
        if self.currently_used_data != []:
            context = ""
            source_filenames = []

            # Collect results from all databases
            all_results = []
            for data in self.currently_used_data:
                # Query the vector database and collect results with their scores
                results = query_rag(input, data.vector_database_path)

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
                context = "\n\n---\n\n".join(context_pieces)

            # Create markdown table of sources
            markdown_table = "\n\n**Sources**\n\n| Filename | Page | Section |\n| -------- | ---- | ------- |\n"
            for filename, page, section in source_filenames:
                markdown_table += f"| {filename} | {page} | {section} |\n"

            formatted_sources = markdown_table
            llm.get_num_tokens(context)

        prompt = make_prompt(input, context, self.currently_used_data)
        chain = prompt | llm
        chain_with_message_history = RunnableWithMessageHistory(
            chain,
            self.get_chat_history,
            input_messages_key="input",
            history_messages_key="chat_history",
        )

        # Stream the model's response
        content_yielded = False
        for chunk in chain_with_message_history.stream({"input": input}):
            if self._cancel_generation:
                # Stop the generation
                return
            content_yielded = True
            yield chunk.content

        # After the model finishes, yield the sources if available
        if formatted_sources is not None and content_yielded:
            # One final check before yielding sources
            if self._cancel_generation:
                return
            yield formatted_sources

        self.num_exchanges += 1
        self.trim_chat_history()


    def cancel_generation(self):
        """Called to stop ongoing generation"""
        self._cancel_generation = True
        print("Generation cancellation requested")

        # Reset the session history state to be ready for new interactions
        # This is important so new requests don't wait for the old Ollama process
        if self.session_history != "":
            # Keep the history but mark that we're ready for new interactions
            # We don't actually delete the history as that would lose context
            # The electron side will have already killed Ollama
            pass  # Ollama is being killed externally

    # Assigns a short summary to a session
    def assign_session_summary(self):
        llm = ChatOllama(model="llama3.2:1b")
        self.session_summary = llm.invoke(
            "Output a sub 5 word short summary blurb of what the topic of this conversation is:"
            + "\n" + str(self.session_history) + "\n" + "make sure the output is under 6 words").content
        print(self.session_summary)

    def get_history_as_string(self):
        messages = self.session_history.messages
        history_string = ""

        for message in messages:
            if hasattr(message, "type"):
                prefix = "User: " if message.type == "human" else "Assistant: "
                history_string += f"{prefix}{message.content}\n"

        return history_string

    def trim_chat_history(self):
        """
        Trims the chat history if it exceeds 8000 characters.
        Keeps the most recent messages and trims from the beginning,
        making sure to cut at the start of a user message for context coherence.
        Stores the clipped history in a text file within the chat_history_storage folder
        and creates an Uploaded_data object with the path to this file.
        """
        import os
        from pathlib import Path
        import time

        # Get all messages
        messages = self.session_history.messages

        # If no messages, nothing to trim
        if not messages:
            return

        # Convert to string to check total length
        history_string = self.get_history_as_string()

        # If under the limit, no need to trim
        if len(history_string) <= 8000:
            return

        # We need to trim
        # Start from most recent and work backwards to find the 8000 character mark
        remaining_chars = 8000
        messages_to_keep = []
        messages_to_clip = []

        # Process messages from newest to oldest (reversed)
        for i, message in enumerate(reversed(messages)):
            message_text = f"{'User: ' if message.type == 'human' else 'Assistant: '}{message.content}\n"
            message_length = len(message_text)

            # If this message fits in our remaining character budget
            if message_length <= remaining_chars:
                messages_to_keep.insert(0, message)  # Insert at beginning to restore original order
                remaining_chars -= message_length
            else:
                # We've hit our limit, but we want to find the next user message for a clean cut
                # If this is already a user message, we'll break after adding it to messages_to_clip
                if message.type == "human":
                    messages_to_clip = list(messages[:len(messages) - i])
                    break

                # If it's an assistant message, we need to include the previous user message too
                # for context, but only if we have more messages to check
                if i < len(messages) - 1:
                    # Find the index in the original list
                    clip_index = len(messages) - i - 1
                    # This will ensure we clip at a user message boundary
                    for j in range(clip_index, -1, -1):
                        if j > 0 and messages[j].type == "human" and messages[j - 1].type == "assistant":
                            messages_to_clip = list(messages[:j])
                            break
                        elif j == 0:
                            messages_to_clip = list(messages[:1])
                    break

                # If we only have this message, we need to keep it even if it's over the limit
                messages_to_keep.insert(0, message)
                break

        # If for some reason we didn't determine which messages to clip,
        # default to clipping all messages not in messages_to_keep
        if not messages_to_clip and len(messages_to_keep) < len(messages):
            messages_to_clip = list(messages[:len(messages) - len(messages_to_keep)])

        # Extract the clipped messages into a string for storing in ltm_session_history
        clipped_history = ""
        for message in messages_to_clip:
            prefix = "User: " if message.type == "human" else "Assistant: "
            clipped_history += f"{prefix}{message.content}\n"

        # Create a new ChatMessageHistory with only the messages we want to keep
        new_history = ChatMessageHistory()

        # Add the kept messages to the new history
        for message in messages_to_keep:
            if message.type == "human":
                new_history.add_user_message(message.content)
            else:
                new_history.add_ai_message(message.content)

        # Replace the old history with the new one
        self.session_history = new_history

        # Store the clipped history to a file and create Uploaded_data
        if clipped_history:
            # Create the storage directory if it doesn't exist
            # Get the project root (assumed to be 3 levels up from this file, same as in Uploaded_data)
            project_root = Path(__file__).resolve().parents[2]
            storage_dir = project_root / 'storage' / 'chat_history_storage'
            os.makedirs(storage_dir, exist_ok=True)

            # Create a unique filename using timestamp
            timestamp = int(time.time() * 1000)  # millisecond precision
            history_filename = f"chat_history_{timestamp}.txt"
            history_filepath = storage_dir / history_filename

            # Get existing history content if available
            existing_content = ""
            if self.ltm_session_history is not None and hasattr(self.ltm_session_history, 'data_path'):
                # Try to read the existing file if it exists
                try:
                    with open(self.ltm_session_history.data_path, 'r', encoding='utf-8') as f:
                        existing_content = f.read()
                except (FileNotFoundError, AttributeError):
                    pass

            # Write combined history to the new file
            with open(history_filepath, 'w', encoding='utf-8') as f:
                f.write(existing_content + clipped_history)

            # Create or update the Uploaded_data object with the path to this file
            self.ltm_session_history = Uploaded_data("chat_history", str(history_filepath), False)

        print(f"Chat history trimmed: {len(messages_to_clip)} messages clipped, {len(messages_to_keep)} messages kept")