#!/bin/sh
set -e

# Fix corrupted .gitconfig: if the orchestrator bind-mount created it as an
# empty directory (Docker behaviour when the host source does not exist at
# container-creation time), replace it with a proper file so that git
# operations succeed.
GITCONFIG="/home/orchestrator/.gitconfig"
if [ -d "$GITCONFIG" ]; then
    # Empty directory — safe to remove and recreate as a file
    if [ -z "$(ls -A "$GITCONFIG" 2>/dev/null)" ]; then
        rm -rf "$GITCONFIG" 2>/dev/null || true
    fi
fi

# If .gitconfig still does not exist (or was just removed above), create a
# minimal one so that git-commit and similar commands do not error out about
# missing user.email / user.name.  Environment variables take precedence if
# set at runtime.
if [ ! -f "$GITCONFIG" ]; then
    cat > "$GITCONFIG" 2>/dev/null <<EOF
[user]
	email = ${GIT_AUTHOR_EMAIL:-agent@documentation-robotics.local}
	name = ${GIT_AUTHOR_NAME:-Documentation Robotics Agent}
EOF
    chmod 644 "$GITCONFIG" 2>/dev/null || true
fi

# Delegate to the base-image entrypoint (which handles SSH, gh auth, etc.)
exec /usr/local/bin/docker-entrypoint.sh "$@"
