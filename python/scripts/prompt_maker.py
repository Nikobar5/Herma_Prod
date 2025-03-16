def make_prompt(context, currently_used_data):
    system_content = "You are a helpful AI assistant named Herma. Answer the most recent question to the best of your ability."
    if context:
        safe_context = context.replace('{', '{{').replace('}', '}}')
        num_docs = len(currently_used_data)
        doc_summaries = []
        for doc in currently_used_data:
            safe_name = doc.name.replace('{', '{{').replace('}', '}}')
            safe_summary = doc.data_summary.replace('{', '{{').replace('}', '}}')
            doc_summaries.append(f"- {safe_name}: {safe_summary}")

        doc_summaries_str = "\n".join(doc_summaries)
        doc_names = [doc.name for doc in currently_used_data]
        safe_doc_names = [name.replace('{', '{{').replace('}', '}}') for name in doc_names]
        doc_names_str = ", ".join(safe_doc_names)
        context_addition = f"""You are currently given context from {num_docs} {'document' if num_docs == 1 else 'documents'} which I want you to use for this response. 
        Their {'name is' if num_docs == 1 else 'names are'}: {doc_names_str}.

        Document Summaries:
        {doc_summaries_str}

        Here is the provided context extracted from these documents:
        {safe_context}"""

    template = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>


    {system_content}<|eot_id|>{{chat_history}}<|start_header_id|>user<|end_header_id|>

    {context_addition if context else ""}{{input}}<|eot_id|><|start_header_id|>assistant<|end_header_id|>"""

    return template
