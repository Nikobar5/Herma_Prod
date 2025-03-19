from langchain_ollama import ChatOllama
from prompt_maker import make_prompt
from uploaded_data import Uploaded_data
from rag_querying import query_rag
import glob
import os
import time
from pathlib import Path
import re


class Session:
    def __init__(self, currently_used_data):
        self.session_summary = ""
        self.session_history = ""
        self.num_exchanges = 0
        self.currently_used_data = currently_used_data
        self._cancel_generation = False
        self.ltm_session_history = None

        try:
            project_root = Path(__file__).resolve().parents[2]
            storage_dir = project_root / 'storage' / 'chat_history_storage'

            if os.path.exists(storage_dir):
                old_files = glob.glob(str(storage_dir / "chat_history_*.txt"))

                for old_file in old_files:
                    base_name = os.path.basename(old_file)
                    os.remove(old_file)
                    Uploaded_data.delete_vector_db(base_name)
            else:
                os.makedirs(storage_dir, exist_ok=True)

        except Exception as e:
            print(f"DEBUG: Error cleaning up chat history storage during initialization: {e}")

    def add_user_message(self, message):
        self.session_history += f"<|start_header_id|>user<|end_header_id|>\n\n{message}<|eot_id|>"

    def add_assistant_message(self, message):
        self.session_history += f"<|start_header_id|>assistant<|end_header_id|>\n{message}<|eot_id|>"

    def ask(self, input):
        self._cancel_generation = False
        llm = ChatOllama(model="llama3.2:1b", num_ctx=4000, temperature=0.6, repeat_penalty=1.2)
        doc_context = None
        formatted_sources = None
        if self.currently_used_data != []:
            doc_context = ""
            source_filenames = []
            all_results = []
            for data in self.currently_used_data:
                results = query_rag(input, data.vector_database_path, 3)
                for doc, score in results:
                    doc.metadata["document_name"] = data.name
                    all_results.append((doc, score))

            all_results.sort(key=lambda x: x[1])

            top_results = all_results[:5]

            if top_results:
                context_pieces = []
                for doc, score in top_results:
                    doc_name = doc.metadata.get("document_name", "Unknown")
                    context_piece = f"From document '{doc_name}':\n{doc.page_content}"
                    context_pieces.append(context_piece)

                    source = doc.metadata.get("id", "").split("/")[-1]
                    file_parts = source.split(" Page: ")
                    filename = file_parts[0]

                    page = "-"
                    section = "-"
                    if len(file_parts) > 1 and ":" in file_parts[1]:
                        page_section = file_parts[1].split(":")
                        page = page_section[0]
                        section = page_section[1] if len(page_section) > 1 else "-"

                    source_filenames.append((filename, page, section))

                doc_context = "\n\n---\n\n".join(context_pieces)

            markdown_table = "\n\n**Sources**\n\n| Filename | Page | Section |\n| -------- | ---- | ------- |\n"
            for filename, page, section in source_filenames:
                markdown_table += f"| {filename} | {page} | {section} |\n"

            formatted_sources = markdown_table

        chat_history_context = ""
        if self.ltm_session_history is not None:
            chat_history_context = "This conversation has been going on for a while, here is some relevant context from " \
                                   "earlier in the conversation that you no longer remember: "

            history_results = query_rag(input, self.ltm_session_history.vector_database_path, 3)

            if history_results:
                history_pieces = []
                for doc, score in history_results:
                    history_pieces.append(doc.page_content)

                chat_history_context += "\n\n".join(history_pieces)
            else:
                chat_history_context += "No relevant earlier context found."

        prompt_template = make_prompt(doc_context, self.currently_used_data)

        complete_prompt = prompt_template.format(
            chat_history=self.session_history,
            input=input
        )

        content_yielded = False
        accumulated_response = ""
        was_interrupted = False

        try:

            for chunk in llm.stream(complete_prompt):
                if self._cancel_generation:
                    was_interrupted = True
                    break

                chunk_content = chunk.content
                chunk_content = re.sub(r'^<\|start_header_id\|>assistant<\|end_header_id\|>\s*', '', chunk_content)
                chunk_content = re.sub(r'<\|eot_id\|>$', '', chunk_content)

                content_yielded = True
                accumulated_response += chunk_content
                yield chunk_content

            if content_yielded:
                self.add_user_message(input)

                if was_interrupted:
                    ai_response = accumulated_response + " [User interrupted response]"
                else:
                    ai_response = accumulated_response

                self.add_assistant_message(ai_response)

        except Exception as e:
            if content_yielded:
                self.add_user_message(input)
                self.add_assistant_message(accumulated_response + " [Response interrupted due to error]")

        if not was_interrupted and formatted_sources is not None and content_yielded:
            yield formatted_sources

        self.num_exchanges += 1
        self.trim_chat_history()

    def cancel_generation(self):
        self._cancel_generation = True


    def get_history_as_string(self):

        pattern = r'<\|start_header_id\|>(user|assistant)<\|end_header_id\|>\s*(.*?)<\|eot_id\|>'

        matches = re.findall(pattern, self.session_history, re.DOTALL)

        history_string = ""
        for role, content in matches:
            prefix = "User: " if role == "user" else "Assistant: "
            history_string += f"{prefix}{content.strip()}\n"

        return history_string

    def trim_chat_history(self):

        history_string = self.get_history_as_string()
        total_length = len(history_string)

        if total_length <= 4000:
            return
        pattern = r'(<\|start_header_id\|>(user|assistant)<\|end_header_id\|>.*?<\|eot_id\|>)'
        message_blocks = re.findall(pattern, self.session_history, re.DOTALL)
        if not message_blocks:
            return

        blocks_to_keep = []
        current_length = 0

        for block_tuple in reversed(message_blocks):
            block = block_tuple[0]

            content_match = re.search(r'<\|end_header_id\|>\s*(.*?)<\|eot_id\|>', block, re.DOTALL)
            if content_match:
                content = content_match.group(1)
                role = "User: " if "user" in block else "Assistant: "
                plain_length = len(f"{role}{content.strip()}\n")

                if current_length + plain_length > 4000:
                    break

                blocks_to_keep.insert(0, block)
                current_length += plain_length
        if len(blocks_to_keep) == len(message_blocks):

            return

        new_history = "".join(blocks_to_keep)

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



        self.session_history = new_history

        if clipped_history:
            project_root = Path(__file__).resolve().parents[2]
            storage_dir = project_root / 'storage' / 'chat_history_storage'
            os.makedirs(storage_dir, exist_ok=True)

            existing_content = ""
            if self.ltm_session_history is not None and hasattr(self.ltm_session_history, 'data_path'):
                try:
                    with open(self.ltm_session_history.data_path, 'r', encoding='utf-8') as f:
                        existing_content = f.read()
                except (FileNotFoundError, AttributeError):

                    pass

            try:
                old_files = glob.glob(str(storage_dir / "chat_history_*.txt"))

                for old_file in old_files:
                    base_name = os.path.basename(old_file)
                    os.remove(old_file)
                    Uploaded_data.delete_vector_db(base_name)

            except Exception as e:
                print(f"DEBUG: Error cleaning up old history files: {e}")

            timestamp = int(time.time() * 1000)
            history_filename = f"chat_history_{timestamp}.txt"
            history_filepath = storage_dir / history_filename

            with open(history_filepath, 'w', encoding='utf-8') as f:
                f.write(existing_content + clipped_history)
            self.ltm_session_history = Uploaded_data(history_filename, str(history_filepath), False, 200)
