from rag_querying import query_rag
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from uploaded_data import Uploaded_data

# Version of make_prompt that doesn't use agent to determine if rag querying should occur, instead queries rag if user
# selects/inputs data
# Metacontext is utilized here to make the model aware of that docs are selected to be searched, if user has interrupted,
# how many docs are selected, names of the docs selected, etc.


def make_prompt(chat_history_context, context, currently_used_data):
    safe_chat_history_context = chat_history_context.replace('{', '{{').replace('}', '}}')

    if context:
        # Escape curly braces in context before using it in an f-string
        safe_context = context.replace('{', '{{').replace('}', '}}')

        num_docs = len(currently_used_data)

        # Create document summaries section
        doc_summaries = []
        for doc in currently_used_data:
            # Escape any potential curly braces in names and summaries
            safe_name = doc.name.replace('{', '{{').replace('}', '}}')
            safe_summary = doc.data_summary.replace('{', '{{').replace('}', '}}')
            doc_summaries.append(f"- {safe_name}: {safe_summary}")

        doc_summaries_str = "\n".join(doc_summaries)

        # Create document names list
        doc_names = [doc.name for doc in currently_used_data]
        safe_doc_names = [name.replace('{', '{{').replace('}', '}}') for name in doc_names]
        doc_names_str = ", ".join(safe_doc_names)

        context_addition = f"""You are currently given context from {num_docs} {'document' if num_docs == 1 else 
        'documents'} to utilize. 
        Their {'name is' if num_docs == 1 else 'names are'}: {doc_names_str}.
        
        Document Summaries:
        {doc_summaries_str}
        
        Here is the provided context extracted from these documents:
        {safe_context}"""

        # Add in later when able to create more functional searchable chat history
        # {safe_chat_history_context}"""


        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful AI assistant named Herma. If the question is ambiguous or you don't know the answer,"
                " ask clarifying questions or say you don't know the answer. Answer the most recent question to the "
                "best of your ability based on "
                "the provided context. " +
                context_addition
            ),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])
    else:
        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful AI assistant named Herma. If the question is ambiguous or you don't know the answer,"
                " ask clarifying questions or say you don't know the answer. Answer the most recent question to the "
                "best of your ability. "
                # + 
                # safe_chat_history_context +
            ),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ])

    return prompt
