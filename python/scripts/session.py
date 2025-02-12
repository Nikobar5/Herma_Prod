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
        # Instantiates the llm to be used, setting the model and context window, other params can also be adjusted
        llm = ChatOllama(model="llama3.2:1b", num_ctx=5000)
        # Get context from all uploaded files selected
        context = None
        formatted_sources = None
        if self.currently_used_data != None:
            context = ""
            sources_text = ""
            for data in self.currently_used_data:
                context_text, sources = query_rag(input, data.vector_database_path)
                sources_text += sources
                context_text += "\n\n"
                context += context_text
            formatted_sources = f"\nSources:"
            formatted_sources += sources_text
            llm.get_num_tokens(context)
        prompt = make_prompt(input, context)
        chain = prompt | llm
        chain_with_message_history = RunnableWithMessageHistory(
            chain,
            self.get_chat_history,
            input_messages_key="input",
            history_messages_key="chat_history",
        )

        # response = ""
        for chunk in chain_with_message_history.stream({"input": input}):
            # print(chunk.content, end="")
            yield chunk.content
            # response += chunk.content

        if (formatted_sources != None):
            # response += formatted_sources
            yield formatted_sources

        self.num_exchanges += 1

    # Assigns a short summary to a session
    def assign_session_summary(self):
        llm = ChatOllama(model="llama3.2:1b")
        self.session_summary = llm.invoke(
            "Output a sub 5 word short summary blurb of what the topic of this conversation is:"
            + "\n" + str(self.session_history) + "\n" + "make sure the output is under 6 words").content
        print(self.session_summary)


