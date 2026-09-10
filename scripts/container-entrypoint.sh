#!/bin/sh
set -eu
# Atlas always initializes its own empty, identity-bound database.
exec "$@"
