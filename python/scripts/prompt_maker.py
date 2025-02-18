from rag_querying import query_rag
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from uploaded_data import Uploaded_data

# Version of make_prompt that doesn't use agent to determine if rag querying should occur, instead queries rag if user
# selects/inputs data

def make_prompt(input, context):
    if context:
        context_addition = "\nHere is the provided context: " + context
        input += context_addition
        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful assistant. Answer all questions to the best of your ability based on the "
                "provided context." + context_addition,
            ),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])
    else:
        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful assistant. Answer all questions to the best of your ability.",
            ),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])
    print(prompt)
    return prompt