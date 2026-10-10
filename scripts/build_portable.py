"""Build the Windows portable EXE and its PNG guides."""
from build_bootstrap import build, package

if __name__ == '__main__':
    build()
    package()
