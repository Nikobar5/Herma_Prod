from rag_querying import query_rag
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from uploaded_data import Uploaded_data

# Version of make_prompt that doesn't use agent to determine if rag querying should occur, instead queries rag if user
# selects/inputs data
# Metacontext is utilized here to make the model aware of that docs are selected to be searched, if user has interrupted,
# how many docs are selected, names of the docs selected, etc.


def make_prompt(input, context, currently_used_data):
    if context:
        # Escape curly braces in context before using it in an f-string
        safe_context = context.replace('{', '{{').replace('}', '}}')

        num_docs = len(currently_used_data)
        doc_names = [doc.name for doc in currently_used_data]
        # Escape any potential curly braces in doc names
        safe_doc_names = [name.replace('{', '{{').replace('}', '}}') for name in doc_names]
        doc_names_str = ", ".join(safe_doc_names)

        context_addition = f"You are currently given {num_docs} documents to search in and utilize. " \
                           f"Their names are: {doc_names_str}. \nHere is the provided context: {safe_context}"
        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful AI assistant named Herma. Answer all questions to the best of your ability based on "
                "the provided context." + context_addition,
            ),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])
    else:
        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful AI assistant. Answer all questions to the best of your ability.",
            ),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])

    return prompt
