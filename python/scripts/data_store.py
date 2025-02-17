import os
import pickle

class DataStore:
    def __init__(self, filename):
        self.filename = filename
        self.data = self._load()

    def _load(self):
        try:
            if not os.path.exists(self.filename):
                print("debug: No existing pickle file, starting fresh")
                return []

            if os.path.getsize(self.filename) == 0:
                print("debug: Empty pickle file, starting fresh")
                return []

            with open(self.filename, 'rb') as file:
                try:
                    return pickle.load(file)
                except (EOFError, pickle.UnpicklingError):
                    print("debug: Corrupted pickle file, starting fresh")
                    return []
        except Exception as e:
            print("debug: Unexpected error in _load")
            return []

    def save(self):
        """Save data to pickle file"""
        print(f"Saving DataStore. Current data length: {len(self.data)}")
        try:
            # Create the directory if it doesn't exist
            os.makedirs(os.path.dirname(self.filename), exist_ok=True)

            # Save to temporary file first
            temp_file = f"{self.filename}.tmp"
            with open(temp_file, 'wb') as file:
                pickle.dump(self.data, file)

            # Rename temp file to actual file (atomic operation)
            os.replace(temp_file, self.filename)
            print(f"DataStore saved successfully to {self.filename}")
        except Exception as e:
            print(f"Failed to save DataStore: {str(e)}")

    def add(self, item):
        self.data.append(item)

    def update(self, index, item):
        self.data[index] = item

    def delete(self, index):
        del self.data[index]

    def get(self, index):
        return self.data[index]
# automatically add chroma db to specific folder for more efficient retrieval and storing
#only have automatic resorting for uploaded data where most recent goes to top since people will more likely reuse it than sessions
#only need add and delete/update when switch at end, need add, get, set, remove for each and then write merge functionality for just uploadd_data