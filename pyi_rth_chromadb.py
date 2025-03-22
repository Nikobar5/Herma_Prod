
import os
import sys
import PyInstaller
import importlib_resources

if hasattr(sys, '_MEIPASS'):
    # Tell chromadb where to find its migrations
    os.environ['CHROMADB_MIGRATIONS_PATH'] = os.path.join(sys._MEIPASS, 'chromadb', 'migrations')
