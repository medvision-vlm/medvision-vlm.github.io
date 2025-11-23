#!/bin/bash
# Setup conda env and serve the Jekyll project page.
# Usage:
#   bash setup_env.sh           # create env (once) + bundle install + jekyll serve
#   SERVE_PORT=8080 bash setup_env.sh
#
# From your local machine, forward the port:
#   kubectl port-forward pod/<name> ${SERVE_PORT}:${SERVE_PORT} -n <namespace>
# Then open http://localhost:${SERVE_PORT}

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="jekyll-medvision"
SERVE_PORT="${SERVE_PORT:-4000}"

eval "$(conda shell.bash hook)"

if conda env list | grep -qE "^${ENV_NAME}\s"; then
    echo "Conda env '${ENV_NAME}' already exists. Skipping creation."
else
    echo "Creating conda env '${ENV_NAME}'..."
    conda env create -f "${SCRIPT_DIR}/environment.yml"
fi

conda activate "${ENV_NAME}"

# Ensure the native-extension build toolchain is present. `bundle install`
# compiles json/bigdecimal (C) and eventmachine (C++), and the conda Ruby's
# rbconfig invokes x86_64-conda-linux-gnu-{cc,c++}. We need:
#   - gcc_linux-64 / gxx_linux-64 : the C and C++ compilers (g++ is required for eventmachine)
#   - sysroot_linux-64 >= 2.28    : matches the glibc symbols libruby.so references (statx@2.28, etc.)
# Idempotent: re-running is a no-op once installed.
conda install -n "${ENV_NAME}" -y -c conda-forge gcc_linux-64 gxx_linux-64 make "sysroot_linux-64>=2.28"

cd "${SCRIPT_DIR}"

if ! gem list bundler -i > /dev/null 2>&1; then
    gem install bundler
fi
bundle install

echo ""
echo "Starting Jekyll on http://0.0.0.0:${SERVE_PORT}"
echo "Port-forward from local:  kubectl port-forward pod/<name> ${SERVE_PORT}:${SERVE_PORT} -n <namespace>"
echo ""
bundle exec jekyll serve --host 0.0.0.0 --port "${SERVE_PORT}"
