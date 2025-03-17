# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['../python/scripts/main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

# Include all Python scripts as data files
import os
import glob

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
    debug=False,
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
    entitlements_file=None,
)