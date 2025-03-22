# -*- mode: python ; coding: utf-8 -*-
import os
import sys
import PyInstaller
import importlib_resources
import glob

# Get the path to PyInstaller's runtime hooks
runtime_hooks_path = os.path.join(
    os.path.dirname(PyInstaller.__file__),
    'hooks',
    'rthooks'
)

chromadb_hook_content = """
import os
import sys
import PyInstaller
import importlib_resources

if hasattr(sys, '_MEIPASS'):
    # Tell chromadb where to find its migrations
    os.environ['CHROMADB_MIGRATIONS_PATH'] = os.path.join(sys._MEIPASS, 'chromadb', 'migrations')
"""

chromadb_hook_path = 'pyi_rth_chromadb.py'
with open(chromadb_hook_path, 'w') as f:
    f.write(chromadb_hook_content)

migrations_path = importlib_resources.files('chromadb').joinpath('migrations')

a = Analysis(
    ['../python/scripts/main.py'],
    pathex=[],
    binaries=[],
    datas=[(str(migrations_path), 'chromadb/migrations'),],
    hiddenimports=[
        # Core dependencies
        'pydantic',
        'pydantic.deprecated',
        'pydantic.deprecated.decorator',
        'pydantic._internal',
        'pydantic._internal._validators',
        'chromadb.migrations.embeddings_queue',
        'chromadb',
        'chromadb.api',
        'chromadb.api.models',
        'chromadb.config',
        'chromadb.db',
        'chromadb.db.impl',
        'chromadb.db.impl.sqlite',
        'importlib_resources',
        'chromadb.quota',
        'chromadb.quota.simple_quota_enforcer',
        'chromadb.rate_limit.simple_rate_limit',
        'chromadb.segment.impl.metadata',
        'chromadb.segment.impl.metadata.sqlite',

        # Add missing dependencies that are causing issues
        'openpyxl',
        'numpy',
        'numpy.random',
        'numpy.random._pickle',
        'numpy.random.mtrand',

        # SSL related modules
        'ssl',
        '_ssl',

        # Your existing dependencies
        'langchain_ollama',
        'langchain_core',
        'pkg_resources',
        'jaraco.text',
        'jaraco.context',
        'urllib.request',
        'hashlib',
        'urllib',
        'urllib.parse',
        'urllib.error',
        'importlib.metadata',
        'importlib.resources',
        'traceback',
        'logging',
        'sys',
        'os',
        'langchain_ollama.embeddings',
        'ollama',
        'chromadb',
        'chromadb.utils',
        'chromadb.utils.embedding_functions',
        'chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2',
        'onnxruntime',
        'tokenizers',
        'tqdm',
        'chromadb.telemetry.product.posthog',
        'chromadb.api.segment',
        'chromadb.db.impl',
        'chromadb.db.impl.sqlite',
        'chromadb.migrations',
        'chromadb.segment.impl.manager',
        'chromadb.segment.impl.manager.local',
        'chromadb.execution.executor.local',

        # Add setuptools dependencies that might be failing
        'setuptools',
        'setuptools.dist',
        'setuptools._entry_points',
        'http.client'
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[
        # Explicitly include all necessary runtime hooks
        chromadb_hook_path,  # Fixed missing comma here
        os.path.join(runtime_hooks_path, 'pyi_rth_pkgutil.py'),
        os.path.join(runtime_hooks_path, 'pyi_rth_inspect.py'),
        os.path.join(runtime_hooks_path, 'pyi_rth_multiprocessing.py'),
        # os.path.join(runtime_hooks_path, 'pyi_rth_setuptools.py'),
        os.path.join(runtime_hooks_path, 'pyi_rth_pkgres.py')
    ],
    excludes=[],
    noarchive=False,
    optimize=0,
    # Move these options to the Analysis constructor
    collect_submodules=['numpy', 'openpyxl'],
    collect_all=['numpy', 'openpyxl']
)

# Include all Python scripts as data files
# Use a direct path to your Python scripts
python_scripts_dir = os.path.join(os.getcwd(), 'python', 'scripts')
script_files = glob.glob(os.path.join(python_scripts_dir, '*.py'))

for script in script_files:
    filename = os.path.basename(script)
    a.datas += [(filename, script, 'DATA')]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='herma_python',
    debug=True,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None
    # Removed collect_submodules and collect_all from here
)