from langchain_ollama import ChatOllama
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

from prompt_maker import make_prompt
from langchain.globals import set_debug
import logging
from uploaded_data import Uploaded_data

from rag_querying import query_rag


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
        llm = ChatOllama(model="llama3.2:1b", num_ctx=100000)
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