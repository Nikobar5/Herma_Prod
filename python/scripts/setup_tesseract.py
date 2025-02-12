import os
import subprocess
import requests

# Define the download URL and installer name
DOWNLOAD_URL = "https://digi.bib.uni-mannheim.de/tesseract/tesseract-5.3.3.20231005.exe"
INSTALLER_NAME = "tesseract-ocr-w64-setup-5.3.3.20231005.exe"
INSTALL_DIR = r"C:\Program Files\Tesseract-OCR"

def download_installer():
    """Download the Tesseract installer."""
    print("Downloading Tesseract OCR installer...")
    response = requests.get(DOWNLOAD_URL, stream=True)
    with open(INSTALLER_NAME, "wb") as file:
        for chunk in response.iter_content(chunk_size=1024):
            if chunk:
                file.write(chunk)
    print("Download complete.")

    # if os.path.getsize(INSTALLER_NAME) < 1024 * 1024:
    #     print("Error: Downloaded file appears corrupted. Try re-running the script.")
    #     os.remove(INSTALLER_NAME)
    #     exit(1)

def install_tesseract():
    """Run the installer silently."""
    print("Installing Tesseract OCR...")
    installer_path = os.path.abspath(INSTALLER_NAME)
    subprocess.run([installer_path, "/SILENT", "/CURRENTUSER"], check=True)
    print("Installation complete.")

def add_to_path():
    """Add Tesseract directory to the system PATH."""
    print("Adding Tesseract to system PATH...")
    current_path = os.environ.get("Path", "")
    if INSTALL_DIR not in current_path:
        subprocess.run(f'setx PATH "{INSTALL_DIR};%PATH%" /M', shell=True)
        print("PATH updated. You may need to restart your terminal.")
    else:
        print("Tesseract is already in the system PATH.")

def cleanup():
    """Remove the installer file."""
    print("Cleaning up installer file...")
    os.remove(INSTALLER_NAME)
    print("Cleanup complete.")

def verify_installation():
    """Verify that Tesseract was installed successfully."""
    try:
        result = subprocess.run(["tesseract", "--version"], capture_output=True, text=True, check=True)
        print("Tesseract installed successfully:")
        print(result.stdout)
    except subprocess.CalledProcessError:
        print("Error: Tesseract installation verification failed.")

if __name__ == "__main__":
    download_installer()
    install_tesseract()
    add_to_path()
    cleanup()
    verify_installation()