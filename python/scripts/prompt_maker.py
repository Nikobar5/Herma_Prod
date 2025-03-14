from rag_querying import query_rag
from uploaded_data import Uploaded_data


# Version of make_prompt that uses Llama 3.1+ prompt templating format
def make_prompt(chat_history_context, context, currently_used_data):
    safe_chat_history_context = chat_history_context.replace('{', '{{').replace('}', '}}')

    # Base system prompt content
    system_content = "You are a helpful AI assistant named Herma. If the question is ambiguous or you don't know the answer, ask clarifying questions or say you don't know the answer. Answer the most recent question to the best of your ability."

    # Add context information if available
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

        context_addition = f"""You are currently given context from {num_docs} {'document' if num_docs == 1 else 'documents'} to utilize. 
        Their {'name is' if num_docs == 1 else 'names are'}: {doc_names_str}.

        Document Summaries:
        {doc_summaries_str}

        Here is the provided context extracted from these documents:
        {safe_context}"""


        # Add in later when able to create more functional searchable chat history
        # {safe_chat_history_context}"""
        system_content += " based on the provided context. " + context_addition


    # Create the Llama 3.1+ formatted prompt template
    template = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>


    {system_content}<|eot_id|>{{chat_history}}<|start_header_id|>user<|end_header_id|>

    {{input}}<|eot_id|>"""

    # Return the formatted template that can be used with string formatting
    return template