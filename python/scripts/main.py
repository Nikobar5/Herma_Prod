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
        root_dir = Path(__file__).parent.parent.parent  # Go up to project root
        self.storage_dir = root_dir / "storage"
        self.upload_dir = self.storage_dir / "uploads"

        # Create directories if they don't exist
        self.storage_dir.mkdir(exist_ok=True)
        self.upload_dir.mkdir(exist_ok=True)

        pickle_path = str(self.storage_dir.resolve() / "uploaded_data_store.pkl")

        # Set up platform-specific signal handlers
        if platform.system() != 'Windows':
            # Unix-like systems
            signal.signal(signal.SIGINT, self.handle_signal)
            signal.signal(signal.SIGTERM, self.handle_signal)
        else:
            # Windows - more limited signal support
            signal.signal(signal.SIGINT, self.handle_signal)
            try:
                signal.signal(signal.SIGBREAK, self.handle_signal)
            except AttributeError:
                # SIGBREAK might not be defined in all environments
                pass

        # Register atexit handler as fallback for Windows and red X button clicks
        atexit.register(self.clean_exit)

        # Store data file in storage directory
        self.uploaded_data_store = DataStore(pickle_path)
        self.session = Session(currently_used_data=[])
        self.is_running = True

    def clean_exit(self):
        """Cleanup method for atexit and other non-signal exits"""
        if self.is_running:  # Only do this if we haven't already done cleanup
            print("Application exiting, saving data...")
            try:
                self.uploaded_data_store.save()
            except Exception as e:
                print(f"Error during exit cleanup: {e}")
            self.is_running = False

    def handle_signal(self, signum, frame):
        """Handle shutdown signals"""
        print(f"Received signal {signum}, saving data and shutting down...")
        self.clean_exit()
        sys.exit(0)

    def handle_ping(self, request_id):
        """Handle ping command to verify connection"""
        print(json.dumps({
            "requestId": request_id,
            "success": True,
            "done": True
        }), flush=True)

    def process_chat(self, message, request_id):
        """Handle chat messages - keeping existing implementation"""
        try:
            for chunk in self.session.ask(message):
                print(json.dumps({
                    "requestId": request_id,
                    "chunk": chunk
                }), flush=True)
            print(json.dumps({
                "requestId": request_id,
                "done": True
            }), flush=True)
        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": str(e)
            }), flush=True)

    def handle_shutdown(self, request_id):
        """Handle shutdown command"""
        print("Received shutdown command, ending run loop...")
        self.is_running = False
        print(json.dumps({
            "requestId": request_id,
            "success": True,
            "done": True
        }), flush=True)

    def handle_new_session(self, request_id):
        """Handle creating a new session"""
        try:
            # Reset the session by creating a new one with empty data
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

    def handle_select(self, request_id, data):
        """Handle file selection for context"""
        try:
            filenames = data.get('filenames', [])
            selected_files = []

            # Since DataStore works with indices, we need to find the indices of our files
            for i, uploaded_data in enumerate(self.uploaded_data_store.data):
                if uploaded_data.name in filenames:
                    selected_files.append(uploaded_data)

            # Update session with selected files list
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

    def handle_delete(self, request_id, data):
        """Handle file deletion requests"""
        try:
            filename = data.get('filename')
            if not filename:
                raise ValueError("Missing filename")

            # Find the index of the file to delete
            file_index = None
            for i, uploaded_data in enumerate(self.uploaded_data_store.data):
                if uploaded_data.name == filename:
                    file_index = i
                    break

            if file_index is not None:
                # Delete the physical file
                file_path = self.upload_dir / filename
                if file_path.exists():
                    file_path.unlink()

                # Delete the vector database
                Uploaded_data.delete_vector_db(filename)

                # Remove from data store
                self.uploaded_data_store.delete(file_index)

                # Update session with remaining files
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
        """Handle file upload requests"""
        try:
            filename = data.get('filename')
            filepath = data.get('filepath')

            if not filename or not filepath:
                raise ValueError("Missing filename or filepath")

            # Create destination path
            destination = self.upload_dir / filename

            # If the file exists, remove it first
            if destination.exists():
                destination.unlink()

            # Move file from temp location to uploads directory
            shutil.move(filepath, destination)

            # Create uploaded data object with the file
            file_data = Uploaded_data(filename, str(destination))

            # Add to data store
            self.uploaded_data_store.add(file_data)

            # Update session with all files
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
                elif command == 'delete':
                    self.handle_delete(request_id, payload)
                elif command == 'select':
                    self.handle_select(request_id, payload)
                elif command == 'shutdown':
                    self.handle_shutdown(request_id)
                elif command == 'new_session':
                    self.handle_new_session(request_id)
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