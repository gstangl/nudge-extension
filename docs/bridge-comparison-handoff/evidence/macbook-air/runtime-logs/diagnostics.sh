set -u
export PLAYWRIGHT_BROWSERS_PATH="<runtime>/browsers" NUDGE_NO_RELOAD=1
step(){ name=$1; dir=$2; shift 2; echo "STEP $name start $(date -u +%FT%TZ) load $(sysctl -n vm.loadavg)"; (cd "$dir" && "$@") > "<runtime>/diag-$name.log" 2>&1; echo "STEP $name exit=$? end $(date -u +%FT%TZ) load $(sysctl -n vm.loadavg)"; }
step js0-chrome "<js0-worktree>" node test/chrome-delivery.mjs --browser chrome --samples 30 --out "<js0-worktree>/artifacts/bridge-comparison/js0-chrome-macbook-air"
step js1-chrome "<repo>" node test/chrome-delivery.mjs --browser chrome --samples 30 --out "<repo>/artifacts/bridge-comparison/js1-chrome-macbook-air"
step rust-chrome "<repo>" env NUDGE_CANDIDATE='["<repo>/bridge-rust/target/release/nudge-bridge-experiment"]' node test/chrome-delivery.mjs --browser chrome --samples 30 --out "<repo>/artifacts/bridge-comparison/rust-chrome-macbook-air"
step paired "<repo>" node test/bridge-compare.mjs --blocks 3 --samples 20
step resources "<repo>" node test/bridge-resources.mjs
step portless "<repo>" node test/portless-worktrees.mjs
echo DONE
