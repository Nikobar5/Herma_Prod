import os
import shutil
import openpyxl
import pandas as pd
import json
import fitz  # PyMuPDF for PDFs
import aiofiles
import chardet
# import pytesseract # OCR for images

from langchain_core import documents
from langchain_ollama import ChatOllama
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain.schema.document import Document
from get_embedding_function import get_embedding_function
from langchain_chroma import Chroma
from concurrent.futures import ThreadPoolExecutor
# from langchain_community.document_loaders.pdf import PyPDFLoader
# from langchain_community.document_loaders.pdf import PyPDFDirectoryLoader
from langchain_community.document_loaders.text import TextLoader
from docx import Document as DocxDocument
from pptx import Presentation
from pathlib import Path
import time
from PIL import Image  # for images


# Run setup.py to setup-dependencies

# class that represents one unit of uploaded data that has been processed, uploaded data is a pdf, a picture, or
# any other single unit, multiple
# units represent multiple instances of uploaded data, later down the road implement merging functionality along with
# renaming but for now each just has the name in the file name. Along with this
# each uploaded data stores a summary of itself and the path to the
# vector database that represents it in semantic form for retrieval. The embedding function can encode and
# decode this so there is no need to store the raw text


class Uploaded_data:
    def __init__(self, name, data_path, non_chat_history):
        self.non_chat_history = non_chat_history
        self.name = name

        self.data_path = data_path
        start_time = time.time()
        self.documents = self.load_documents(self.data_path)
        end_time = time.time()
        print(f"Execution time for load documents is: {end_time - start_time:.6f} seconds")


        # Create a unique database path with timestamp
        self.timestamp = int(time.time() * 1000)  # millisecond precision
        self.vector_database_path = f"{name}_{self.timestamp}"

        self.add_to_chroma()

        if non_chat_history:
            print(f"Generating summary for {name}...")
            self.data_summary = self.generate_summary()
            print(f"Summary generated for {name}")




    #   Accepted file types .pdf, .txt, .md, .docx, .pptx, .xlsx, .csv, .json
    def load_documents(self, data_path):
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"File not found: {data_path}")
        if os.path.isdir(data_path):
            # document_loader = PyPDFDirectoryLoader(data_path) TO-DO
            raise FileNotFoundError("Directory loading not supported. Provide a single file.")
        elif data_path.lower().endswith(".pdf"):
            # document_loader = PyPDFLoader(data_path)
            return self._process_pdf(data_path)
        # elif data_path.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff")):
        #     return self._process_image(data_path)
        elif data_path.lower().endswith((".txt", ".md")):
            return self._process_text(data_path)
        elif data_path.lower().endswith(".docx"):
            return self._process_word(data_path)
        elif data_path.lower().endswith(".pptx"):
            return self._process_pptx(data_path)
        elif data_path.lower().endswith(".xlsx"):
            return self._process_excel(data_path)
        elif data_path.lower().endswith(".csv"):
            return self._process_csv(data_path)
        elif data_path.lower().endswith(".json"):
            return self._process_json(data_path)
        else:
            raise ValueError(f"Unsupported file type for: {data_path}")
        try:
            return document_loader.load()
        except Exception as e:
            raise RuntimeError(f"Failed to load documents from {data_path}: {e}")

    def _process_pdf(self, pdf_path):
        documents = []
        doc = fitz.open(pdf_path)

        for i, page in enumerate(doc):
            text = page.get_text("text")
            table_text = self._extract_tables_from_pdf(page)
            combined_text = f"{text}\n\nTables:\n{table_text}" if table_text else text

            documents.append(Document(page_content=combined_text, metadata={"source": pdf_path, "page": i + 1}))
            # Processing images still in the works, uncomment when functionality is finished
            # images = self._extract_images_from_pdf(page)
            # for img_text, img_meta in images:
            #     documents.append(Document(page_content=img_text, metadata=img_meta))

        return documents

    def _extract_tables_from_pdf(self, page):
        """
        Extract tables from PDF page and format them as Markdown tables.
        """
        markdown_tables = []
        raw_text = page.get_text("text")

        if not raw_text:
            return ""

        # Split the text into potential table sections
        # We're looking for consecutive lines that might form a table
        rows = raw_text.split("\n")

        # Process potential tables
        table_rows = []
        in_table = False

        for row in rows:
            # Simple heuristic to detect table rows (contains tabs or multiple spaces)
            if "\t" in row or "  " in row:  # Using double space as a more conservative delimiter
                # This might be a table row
                if not in_table:
                    in_table = True
                    table_rows = []

                # Split the row into cells using tabs or multiple spaces
                cells = []
                if "\t" in row:
                    cells = row.split("\t")
                else:
                    # Split by multiple spaces, but preserve single spaces within cells
                    import re
                    cells = re.split(r'  +', row)

                # Clean up cells (strip extra spaces)
                cells = [cell.strip() for cell in cells]
                table_rows.append(cells)
            else:
                # If we were in a table and now found non-table text, convert the table we've collected
                if in_table and table_rows:
                    markdown_table = self._convert_to_markdown_table(table_rows)
                    markdown_tables.append(markdown_table)
                    in_table = False

        # Handle case where table goes to the end of the page
        if in_table and table_rows:
            markdown_table = self._convert_to_markdown_table(table_rows)
            markdown_tables.append(markdown_table)

        return "\n\n".join(markdown_tables)

    def _extract_images_from_pdf(self, page):
        extracted_texts = []
        image_list = page.get_images(full=True)

        for img_index, img in enumerate(image_list):
            xref = img[0]
            base_image = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            img_path = f"temp_image_{xref}.png"
            base_image.pil_save(img_path)

            img_text = self._process_image(img_path)
            os.remove(img_path)

            extracted_texts.append(
                (img_text[0].page_content, {"source": page.parent.name, "page": page.number + 1, "type": "image"}))

        return extracted_texts

    def _convert_to_markdown_table(self, table_rows):
        """
        Convert a list of cell rows into a Markdown table.

        Args:
            table_rows: List of lists, where each inner list contains cells for a row

        Returns:
            String containing a properly formatted Markdown table
        """
        if not table_rows or len(table_rows) == 0:
            return ""

        # Determine the max number of columns
        max_cols = max(len(row) for row in table_rows)

        # Make sure all rows have the same number of columns
        normalized_rows = []
        for row in table_rows:
            if len(row) < max_cols:
                # Pad with empty cells
                normalized_rows.append(row + [''] * (max_cols - len(row)))
            else:
                normalized_rows.append(row)

        # Create the markdown table
        markdown_lines = []

        # First row becomes the header
        header = normalized_rows[0]
        markdown_lines.append('| ' + ' | '.join(header) + ' |')

        # Add the separator row
        markdown_lines.append('| ' + ' | '.join(['---'] * len(header)) + ' |')

        # Add the data rows
        for row in normalized_rows[1:]:
            markdown_lines.append('| ' + ' | '.join(row) + ' |')

        return '\n'.join(markdown_lines)

    ##### NEED TO AUTOMATE TESSERACT INSTALATION BEFORE IT CAN RUN #####
    # def _process_image(self, image_path):
    #     try:
    #         image = Image.open(image_path)
    #         text = pytesseract.image_to_string(image)
    #         return [Document(page_content=text, metadata={"source": image_path})]
    #     except Exception as e:
    #         raise RuntimeError(f"Failed to process image {image_path}: {e}")

    def split_documents(self):
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
            length_function=len,
            is_separator_regex=False,
        )
        with ThreadPoolExecutor() as executor:
            results = list(executor.map(text_splitter.split_documents, [self.documents]))
            return [chunk for sublist in results for chunk in sublist]

    def _process_text(self, text_path):
        with open(text_path, "r", encoding="utf-8") as f:
            text = f.read()
        return [Document(page_content=text, metadata={"source": text_path})]

    def _process_word(self, word_path):
        try:
            doc = DocxDocument(word_path)
            text = "\n".join([p.text for p in doc.paragraphs])
            return [Document(page_content=text, metadata={"source": word_path})]
        except Exception as e:
            raise RuntimeError(f"Failed to process Word document {word_path}: {e}")

    def _process_pptx(self, pptx_path):
        try:
            prs = Presentation(pptx_path)
            text = "\n".join([shape.text for slide in prs.slides for shape in slide.shapes if hasattr(shape, "text")])
            return [Document(page_content=text, metadata={"source": pptx_path})]
        except Exception as e:
            raise RuntimeError(f"Failed to process PowerPoint file {pptx_path}: {e}")

    def _process_excel(self, excel_path):
        try:
            wb = openpyxl.load_workbook(excel_path)
            text = "\n".join(
                ["\t".join([str(cell.value) for cell in row]) for sheet in wb for row in sheet.iter_rows()])
            return [Document(page_content=text, metadata={"source": excel_path})]
        except Exception as e:
            raise RuntimeError(f"Failed to process Excel file {excel_path}: {e}")

    async def _process_csv(self, csv_path):
        with open(csv_path, "rb") as f:
            raw_data = f.read()
            result = chardet.detect(raw_data)
            encoding = result["encoding"]
        if encoding != "utf-8":
            encoding = "utf-8"
        async with aiofiles.open(csv_path, "r", encoding=encoding, errors="replace") as f:
            text = await f.read()
        return [Document(page_content=text, metadata={"source": csv_path})]

    async def _process_json(self, json_path):
        async with aiofiles.open(json_path, "r", encoding="utf-8") as f:
            text = await f.read()
        return [Document(page_content=text, metadata={"source": json_path})]

    def add_to_chroma(self):
        start_time = time.time()
        chunks = self.split_documents()
        end_time = time.time()
        print(f"Execution time for split documents is: {end_time - start_time:.6f} seconds")
        # Load the existing database.
        db_path = self.get_db_path()
        db = Chroma(
            persist_directory=str(db_path),
            embedding_function=get_embedding_function()
        )
        start_time = time.time()
        # Calculate Page IDs.
        chunks_with_ids = self.calculate_chunk_ids(chunks)
        end_time = time.time()
        print(f"Execution time for calculate page IDs is: {end_time - start_time:.6f} seconds")
        # Add or Update the documents.
        start_time = time.time()
        existing_items = db.get(include=[])  # IDs are always included by default
        existing_ids = set(existing_items["ids"])
        print(f"Number of existing documents in DB: {len(existing_ids)}")
        end_time = time.time()
        print(f"Execution time for add/update documents is: {end_time - start_time:.6f} seconds")
        start_time = time.time()
        # Only add documents that don't exist in the DB.
        # new_chunks = [chunk for chunk in chunks_with_ids if chunk.metadata["id"] not in existing_ids]
        new_chunks = chunks_with_ids
        # if new_chunks:
        new_chunk_ids = [chunk.metadata["id"] for chunk in new_chunks]
        db.add_documents(new_chunks, ids=new_chunk_ids)
        print("Added documents")
        end_time = time.time()
        print(f"Execution time for adding documents is: {end_time - start_time:.6f} seconds")

    def calculate_chunk_ids(self, chunks):

        # This will create IDs like "data/report.pdf:6:2"
        # Page Source : Page Number : Chunk Index

        last_page_id = None
        current_chunk_index = 0

        for chunk in chunks:
            source = chunk.metadata.get("source", "unknown")
            page = chunk.metadata.get("page", 0)
            current_page_id = f"{source} Page: {page}"

            # If the page ID is the same as the last one, increment the index.
            if current_page_id == last_page_id:
                current_chunk_index += 1
            else:
                current_chunk_index = 0

            # Calculate the chunk ID.
            chunk_id = f"{current_page_id}:{current_chunk_index}"
            last_page_id = current_page_id

            # Add it to the page meta-data.
            chunk.metadata["id"] = chunk_id

        return chunks

    def generate_summary(self):
        """Generate a summary of the document using the first and last two chunks"""
        from langchain_ollama import ChatOllama

        # Get the first and last two chunks
        chunks = self.split_documents()
        if not chunks:
            return "No content available for summarization."

        # If we have fewer than 4 chunks, use all available chunks
        sample_chunks = []
        if len(chunks) >= 4:
            sample_chunks = chunks[:2] + chunks[-2:]
        else:
            sample_chunks = chunks

        # Extract text from chunks
        sample_text = "\n\n---\n\n".join([chunk.page_content for chunk in sample_chunks])

        # Create a summarization prompt
        summary_prompt = f"""
        Below is text from the first and last parts of a document titled '{self.name}'. 

        Please provide a TWO-SENTENCE summary of what this document is about.
        Include any information about: title, author, publishing date, main topic, key implications. 
        Format your response as a paragraph without bullet points.

        DOCUMENT TEXT:
        {sample_text}
        """

        # Initialize LLM and generate summary
        llm = ChatOllama(model="llama3.2:1b")
        result = llm.invoke(summary_prompt)

        return result.content

    @staticmethod
    def get_project_root():
        """Get the absolute path to the project root"""
        return Path(__file__).resolve().parents[2]  # Goes up three levels: python/scripts -> python -> root

    def get_db_path(self):
        """Get the vector database path for this uploaded data"""
        # Use the timestamped path instead of just the name
        return self.get_project_root() / 'storage' / 'db_store' / self.vector_database_path

    @staticmethod
    def delete_vector_db(filename):
        """
        Instead of trying to delete a specific database, this method now
        finds and deletes all databases associated with a filename.
        """
        # Find all database directories that match the filename pattern
        db_root = Uploaded_data.get_project_root() / 'storage' / 'db_store'

        # List all directories that start with the filename
        matching_dbs = [d for d in os.listdir(str(db_root))
                        if d.startswith(filename + "_") or d == filename]

        for db_name in matching_dbs:
            db_path = db_root / db_name
            if os.path.exists(str(db_path)):
                try:
                    # Simple deletion - we don't need complex logic anymore
                    # since we're using unique paths
                    import shutil
                    shutil.rmtree(str(db_path))
                    print(f"Deleted database: {db_path}")
                except Exception as e:
                    print(f"Error deleting database {db_path}: {e}")