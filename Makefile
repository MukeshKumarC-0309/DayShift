# Dayshift — common tasks.
#
#   make dev     run the whole app (backend + frontend)
#   make check   everything CI runs, in one shot
#
# `make` with no target prints this list.

VENV := .venv
PY   := $(VENV)/bin/python
PIP  := $(VENV)/bin/pip
FE   := frontend

.DEFAULT_GOAL := help
.PHONY: help dev install install-command uninstall-command install-backend install-frontend test lint lint-fix \
        format format-check typecheck build check clean reset-db

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

dev: ## Run backend + frontend together
	./start.sh

install: install-backend install-frontend ## Install all dependencies

install-backend: ## Create the venv and install Python dependencies
	@test -d $(VENV) || python3 -m venv $(VENV)
	@$(PIP) install --quiet --upgrade pip
	@$(PIP) install --quiet -r requirements.txt -r requirements-dev.txt

install-frontend: ## Install frontend dependencies
	@cd $(FE) && npm install --no-fund --no-audit

test: ## Run the Python test suite
	@$(PY) -m pytest

api-types: ## Regenerate frontend/src/api/schema.d.ts from the backend's OpenAPI
	@$(VENV)/bin/python scripts/dump_openapi.py > $(FE)/.openapi.json
	@cd $(FE) && npx openapi-typescript .openapi.json -o src/api/schema.d.ts --silent >/dev/null && rm .openapi.json

api-types-check: ## Fail if schema.d.ts is stale (backend changed, types not regenerated)
	@$(VENV)/bin/python scripts/dump_openapi.py > $(FE)/.openapi.json
	@cd $(FE) && npx openapi-typescript .openapi.json -o .schema.check.d.ts --silent >/dev/null && rm .openapi.json
	@cmp -s $(FE)/.schema.check.d.ts $(FE)/src/api/schema.d.ts \
		|| (rm -f $(FE)/.schema.check.d.ts; echo "schema.d.ts is stale: run 'make api-types'"; exit 1)
	@rm -f $(FE)/.schema.check.d.ts

test-frontend: ## Run the frontend component and unit tests (Vitest)
	@cd $(FE) && npx vitest run

e2e: ## End-to-end run in your installed Brave/Chrome (skipped if none)
	@cd $(FE) && npx playwright test --pass-with-no-tests

lint: ## Lint backend and frontend
	@$(VENV)/bin/ruff check backend tests scripts
	@cd $(FE) && npx eslint .

lint-fix: ## Auto-fix what can be fixed
	@$(VENV)/bin/ruff check backend tests scripts --fix
	@cd $(FE) && npx eslint . --fix

format: ## Format everything
	@$(VENV)/bin/ruff format backend tests scripts
	@cd $(FE) && npx prettier --write .

format-check: ## Verify formatting without writing
	@$(VENV)/bin/ruff format --check backend tests scripts
	@cd $(FE) && npx prettier --check .

typecheck: ## Type-check the frontend
	@cd $(FE) && npx tsc --noEmit

build: ## Production build of the frontend
	@cd $(FE) && npm run build

check: lint format-check api-types-check typecheck test test-frontend e2e ## Everything, end to end
	@echo "All checks passed."

clean: ## Remove build artifacts and caches
	@rm -rf $(FE)/dist $(FE)/tsconfig.tsbuildinfo .pytest_cache .ruff_cache backend.log \
		$(FE)/test-results $(FE)/playwright-report
	@find . -name __pycache__ -type d -not -path './node_modules/*' -exec rm -rf {} + 2>/dev/null || true

BIN_DIR ?= $(shell brew --prefix 2>/dev/null || echo /usr/local)/bin

install-command: ## Put a `dayshift` command on your PATH (a link to bin/dayshift)
	@ln -sfn "$(CURDIR)/bin/dayshift" "$(BIN_DIR)/dayshift"
	@echo "Installed: $(BIN_DIR)/dayshift → bin/dayshift. Type 'dayshift' in any terminal."

uninstall-command: ## Remove the `dayshift` command
	@rm -f "$(BIN_DIR)/dayshift" && echo "Removed $(BIN_DIR)/dayshift"

reminder-install: ## Install the evening reminder (per-user launchd job, every 15 min)
	@scripts/reminder-launchd.sh install

reminder-uninstall: ## Remove the evening reminder
	@scripts/reminder-launchd.sh uninstall

reminder-test: ## Show what tonight's reminder would say, without sending it
	@$(VENV)/bin/python scripts/reminder.py --now --dry-run

bench: ## Time the heaviest endpoints on a large synthetic history (temp DB)
	$(VENV)/bin/python scripts/benchmark.py

reset-db: ## Delete the database (it is recreated and re-seeded on next start)
	@rm -f dayshift.db
	@echo "dayshift.db removed — it will be recreated on next start."
