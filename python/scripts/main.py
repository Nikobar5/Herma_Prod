import sys
import json
import shutil
import atexit
from pathlib import Path
from session import Session
from uploaded_data import Uploaded_data
from data_store import DataStore
import signal
import platform

class PythonServer:
    def __init__(self):
        self.active_requests = {}
        root_dir = Path(__file__).parent.parent.parent
        self.storage_dir = root_dir / "storage"
        self.upload_dir = self.storage_dir / "uploads"
        self.storage_dir.mkdir(exist_ok=True)
        self.upload_dir.mkdir(exist_ok=True)
        pickle_path = str(self.storage_dir.resolve() / "uploaded_data_store.pkl")
        if platform.system() != 'Windows':
            signal.signal(signal.SIGINT, self.handle_signal)
            signal.signal(signal.SIGTERM, self.handle_signal)
        else:
            signal.signal(signal.SIGINT, self.handle_signal)
            try:
                signal.signal(signal.SIGBREAK, self.handle_signal)
            except AttributeError:
                pass

        atexit.register(self.clean_exit)

        self.uploaded_data_store = DataStore(pickle_path)
        self.session = Session(currently_used_data=[])
        self.is_running = True

    def clean_exit(self):
        if self.is_running:

            try:
                self.uploaded_data_store.save()
            except Exception as e:
                print(f"Error during exit cleanup: {e}")
            self.is_running = False

    def handle_signal(self, signum, frame):
        """Handle shutdown signals"""

        self.clean_exit()
        sys.exit(0)

    def handle_ping(self, request_id):
        print(json.dumps({
            "requestId": request_id,
            "success": True,
            "done": True
        }), flush=True)

    def process_chat(self, message, request_id):
        try:
            self.active_requests[request_id] = "active"

            if message.startswith("_BASE64_"):
                import base64
                encoded_part = message[len("_BASE64_"):]
                try:
                    message = base64.b64decode(encoded_part).decode('utf-8')
                except Exception as e:
                    print(f"Error decoding message: {e}")
            response_generator = self.session.ask(message)

            for chunk in response_generator:
                if self.active_requests.get(request_id) == "interrupted":
                    print(json.dumps({
                        "requestId": request_id,
                        "done": True
                    }), flush=True)
                    self.active_requests.pop(request_id, None)
                    return

                print(json.dumps({
                    "requestId": request_id,
                    "chunk": chunk
                }), flush=True)

            print(json.dumps({
                "requestId": request_id,
                "done": True
            }), flush=True)
            print("DEBUG: Python sent done signal", flush=True)

            self.active_requests.pop(request_id, None)
        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": str(e)
            }), flush=True)
            self.active_requests.pop(request_id, None)

    def handle_shutdown(self, request_id):
        self.is_running = False
        print(json.dumps({
            "requestId": request_id,
            "success": True,
            "done": True
        }), flush=True)

    def handle_new_session(self, request_id):
        try:
            self.session = Session(currently_used_data=[])

            print(json.dumps({
                "requestId": request_id,
                "success": True,
                "done": True
            }), flush=True)
        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": f"New session creation failed: {str(e)}"
            }), flush=True)

    def handle_get_files(self, request_id):
        try:
            filenames = [uploaded_data.name for uploaded_data in self.uploaded_data_store.data]

            print(json.dumps({
                "requestId": request_id,
                "files": filenames,
                "success": True,
                "done": True
            }), flush=True)
        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": f"Get files failed: {str(e)}"
            }), flush=True)

    def handle_select(self, request_id, data):
        try:
            filenames = data.get('filenames', [])
            selected_files = []

            for i, uploaded_data in enumerate(self.uploaded_data_store.data):
                if uploaded_data.name in filenames:
                    selected_files.append(uploaded_data)

            self.session.currently_used_data = selected_files

            print(json.dumps({
                "requestId": request_id,
                "success": True,
                "done": True
            }), flush=True)

        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": f"Selection failed: {str(e)}"
            }), flush=True)

    def handle_interrupt(self, request_id, data):
        try:
            target_request_id = data.get('requestId')
            if not target_request_id:
                raise ValueError("Missing target requestId")

            self.active_requests[target_request_id] = "interrupted"

            self.session.cancel_generation()

            print(json.dumps({
                "requestId": request_id,
                "success": True,
                "done": True
            }), flush=True)

            self.active_requests.pop(target_request_id, None)

        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": f"Interrupt failed: {str(e)}"
            }), flush=True)

    def handle_delete(self, request_id, data):
        try:
            filename = data.get('filename')
            if not filename:
                raise ValueError("Missing filename")

            file_index = None
            for i, uploaded_data in enumerate(self.uploaded_data_store.data):
                if uploaded_data.name == filename:
                    file_index = i
                    break

            if file_index is not None:
                file_path = self.upload_dir / filename
                if file_path.exists():
                    file_path.unlink()

                Uploaded_data.delete_vector_db(filename)

                self.uploaded_data_store.delete(file_index)

                self.session.currently_used_data = self.uploaded_data_store.data

            print(json.dumps({
                "requestId": request_id,
                "success": True,
                "done": True
            }), flush=True)

        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": f"Delete failed: {str(e)}"
            }), flush=True)

    def handle_upload(self, request_id, data):
        try:
            filename = data.get('filename')
            filepath = data.get('filepath')

            if not filename or not filepath:
                raise ValueError("Missing filename or filepath")

            destination = self.upload_dir / filename

            if destination.exists():
                destination.unlink()

            shutil.move(filepath, destination)

            file_data = Uploaded_data(filename, str(destination), True, 400)

            self.uploaded_data_store.add(file_data)

            self.session.currently_used_data = self.uploaded_data_store.data

            print(json.dumps({
                "requestId": request_id,
                "success": True,
                "done": True
            }), flush=True)

        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": f"Upload failed: {str(e)}"
            }), flush=True)

    def run(self):
        while self.is_running:
            try:
                line = sys.stdin.readline()
                if not line:
                    break

                data = json.loads(line)
                request_id = data.get('requestId')
                command = data.get('command')
                payload = data.get('data', {})

                if command == 'ping':
                    self.handle_ping(request_id)
                elif command == 'chat':
                    self.process_chat(payload['message'], request_id)
                elif command == 'upload':
                    self.handle_upload(request_id, payload)
                elif command == 'interrupt':
                    self.handle_interrupt(request_id, payload)
                elif command == 'delete':
                    self.handle_delete(request_id, payload)
                elif command == 'select':
                    self.handle_select(request_id, payload)
                elif command == 'shutdown':
                    self.handle_shutdown(request_id)
                elif command == 'new_session':
                    self.handle_new_session(request_id)
                elif command == 'get_files':
                    self.handle_get_files(request_id)
                else:
                    print(json.dumps({
                        "requestId": request_id,
                        "error": f"Unknown command: {command}"
                    }), flush=True)

            except Exception as e:
                error_msg = {
                    "error": str(e)
                }
                if 'request_id' in locals():
                    error_msg["requestId"] = request_id
                print(json.dumps(error_msg), flush=True)
        self.uploaded_data_store.save()


if __name__ == "__main__":
    server = PythonServer()
    server.run()