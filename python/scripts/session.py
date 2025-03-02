from langchain_ollama import ChatOllama
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

from prompt_maker import make_prompt
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
        self.session_summary = ""
        self.session_history = ""
        self.num_exchanges = 0
        # List of uploaded_data that is being used
        self.currently_used_data = currently_used_data

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
        # Instantiates the llm to be used, setting the model and context window, other params can also be adjusted
        llm = ChatOllama(model="llama3.2:1b", num_ctx=5000)
        # Get context from all uploaded files selected
        context = None
        formatted_sources = None
        if self.currently_used_data != []:
            context = ""
            source_filenames = []
            for data in self.currently_used_data:
                context_text, sources = query_rag(input, data.vector_database_path)
                context += context_text + "\n\n"

                # Parse source filenames and add to our collection
                # Each source will be in format "filename\nfilename\n..."
                if sources and sources.strip():
                    source_lines = sources.strip().split('\n')
                    for line in source_lines:
                        if line.strip():  # Skip empty lines
                            # Parse page and section if available (format might be "filename Page: X:Y")
                            file_parts = line.split(" Page: ")
                            filename = file_parts[0]

                            # Extract page and section if available
                            page = "-"
                            section = "-"
                            if len(file_parts) > 1 and ":" in file_parts[1]:
                                page_section = file_parts[1].split(":")
                                page = page_section[0]
                                section = page_section[1] if len(page_section) > 1 else "-"

                            source_filenames.append((filename, page, section))

            # Create markdown table
            markdown_table = "\n\n**Sources**\n\n| Filename | Page | Section |\n| -------- | ---- | ------- |\n"
            for filename, page, section in source_filenames:
                markdown_table += f"| {filename} | {page} | {section} |\n"

            formatted_sources = markdown_table
            llm.get_num_tokens(context)

        prompt = make_prompt(input, context)
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
            content_yielded = True
            yield chunk.content

        # After the model finishes, yield the sources if available
        if formatted_sources is not None and content_yielded:
            yield formatted_sources

        self.num_exchanges += 1

    # Assigns a short summary to a session
    def assign_session_summary(self):
        llm = ChatOllama(model="llama3.2:1b")
        self.session_summary = llm.invoke(
            "Output a sub 5 word short summary blurb of what the topic of this conversation is:"
            + "\n" + str(self.session_history) + "\n" + "make sure the output is under 6 words").content
        print(self.session_summary)


