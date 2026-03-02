#!/bin/sh
set -e

# Fix corrupted .gitconfig: if the orchestrator bind-mount created
# /home/orchestrator/.gitconfig as an empty directory (Docker behaviour when
# the host source does not exist at container-creation time), git will refuse
# to read it.  We cannot remove a bind-mount from inside the container, so
# instead we redirect git to an alternative global config file via
# GIT_CONFIG_GLOBAL.
GITCONFIG="/home/orchestrator/.gitconfig"
GITCONFIG_ALT="/home/orchestrator/.gitconfig-agent"

if [ -d "$GITCONFIG" ]; then
    # .gitconfig is a directory (corrupted mount) — redirect git to an
    # alternative file that we control.
    if [ ! -f "$GITCONFIG_ALT" ]; then
        cat > "$GITCONFIG_ALT" <<EOF
[user]
	email = ${GIT_AUTHOR_EMAIL:-agent@documentation-robotics.local}
	name = ${GIT_AUTHOR_NAME:-Documentation Robotics Agent}
EOF
        chmod 644 "$GITCONFIG_ALT" 2>/dev/null || true
    fi
    export GIT_CONFIG_GLOBAL="$GITCONFIG_ALT"
elif [ ! -f "$GITCONFIG" ]; then
    # .gitconfig does not exist at all — create a minimal one so that
    # git-commit and similar commands do not error out.
    cat > "$GITCONFIG" 2>/dev/null <<EOF
[user]
	email = ${GIT_AUTHOR_EMAIL:-agent@documentation-robotics.local}
	name = ${GIT_AUTHOR_NAME:-Documentation Robotics Agent}
EOF
    chmod 644 "$GITCONFIG" 2>/dev/null || true
fi

# Delegate to the base-image entrypoint (which handles SSH, gh auth, etc.)
exec /usr/local/bin/docker-entrypoint.sh "$@"
