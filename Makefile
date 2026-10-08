# Secure Cloud — one entry point for development, testing and operations.
#
# These are deliberately thin wrappers: every target runs a command that is already
# documented in README.md, deploy/ or monitoring/. Nothing here bypasses the
# installer, Compose or Prisma, so the Makefile can never drift from reality.
#
# Run `make` or `make help` for the list.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
BACKEND := --workspace backend
FRONTEND := --workspace frontend

.PHONY: help
help: ## List every available target
	@printf '\nSecure Cloud targets:\n\n'
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@printf '\n'

## ---------------------------------------------------------------- development
.PHONY: deps
deps: ## Install both npm workspaces
	npm ci

.PHONY: dev
dev: ## Run backend (:4000) and frontend (:3000) in development mode
	npm run dev

.PHONY: build
build: ## Production build for both workspaces
	npm run build

.PHONY: typecheck
typecheck: ## TypeScript check for both workspaces
	npm run typecheck

.PHONY: lint
lint: ## ESLint (backend) and next lint (frontend)
	npm run lint

.PHONY: test
test: ## Backend test suite (integration tests skip without TEST_DATABASE_URL)
	npm test

.PHONY: test-integration
test-integration: ## Run every test including the database integration suite
	@test -n "$$TEST_DATABASE_URL" || { echo 'Set TEST_DATABASE_URL to a disposable database first.'; exit 1; }
	DATABASE_URL="$$TEST_DATABASE_URL" npm run prisma:deploy $(BACKEND)
	TEST_DATABASE_URL="$$TEST_DATABASE_URL" npm test

.PHONY: check
check: typecheck lint test ## Typecheck + lint + test (the CI gate)

## -------------------------------------------------------------------- database
.PHONY: db-up
db-up: ## Start PostgreSQL and Redis only
	$(COMPOSE) up -d --wait postgres redis

.PHONY: db-migrate
db-migrate: ## Apply pending Prisma migrations
	npm run prisma:deploy $(BACKEND)

.PHONY: db-generate
db-generate: ## Regenerate the Prisma client
	npm run prisma:generate $(BACKEND)

.PHONY: db-recalculate
db-recalculate: ## Rebuild storageUsed counters from file metadata (API stopped)
	npm run prisma:recalculate $(BACKEND)

## --------------------------------------------------------------- docker stack
.PHONY: install
install: ## Run the idempotent Ubuntu installer
	sudo bash install.sh

.PHONY: up
up: ## Build and start the single-host stack with live container logs
	$(COMPOSE) up --build

.PHONY: up-detached
up-detached: ## Build and start the stack in the background, gated on healthchecks
	$(COMPOSE) up -d --build --wait --wait-timeout 180

.PHONY: down
down: ## Stop the stack (volumes, images and user files are preserved)
	$(COMPOSE) stop

.PHONY: ps
ps: ## Show container status, including the one-shot migration job
	$(COMPOSE) ps -a

.PHONY: logs
logs: ## Follow all container logs
	$(COMPOSE) logs -f --tail=100

.PHONY: health
health: ## Check the public health endpoint through Nginx
	curl --fail --silent --show-error --max-time 10 http://localhost:8080/health && printf '\n'

.PHONY: cloudflare
cloudflare: ## Start a Cloudflare Quick Tunnel and print its temporary URL
	bash scripts/start-cloudflare.sh

.PHONY: cloudflare-stop
cloudflare-stop: ## Stop the managed Cloudflare Quick Tunnel
	bash scripts/stop-cloudflare.sh

.PHONY: metrics
metrics: ## Print application metrics from the private loopback listener
	curl --fail --silent --max-time 10 http://127.0.0.1:4001/metrics | grep -E '^secure_cloud_' | head -30

## ------------------------------------------------------------------- quality
.PHONY: validate
validate: ## Validate Compose, Prometheus, Alloy, Loki and Nginx configuration
	bash monitoring/scripts/validate.sh

.PHONY: smoke
smoke: ## Build CI images and run the disposable container smoke test
	bash scripts/smoke-containers.sh

.PHONY: security
security: ## Scan the filesystem for vulnerable dependencies, secrets and misconfiguration
	docker run --rm -v "$$PWD:/repo" aquasecurity/trivy:latest \
		fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed /repo

.PHONY: sbom
sbom: ## Generate CycloneDX SBOMs for both images into ./sbom
	mkdir -p sbom
	docker run --rm -v "$$PWD:/work" aquasecurity/trivy:latest image \
		--format cyclonedx --output /work/sbom/backend.cdx.json secure-cloud-backend:local
	docker run --rm -v "$$PWD:/work" aquasecurity/trivy:latest image \
		--format cyclonedx --output /work/sbom/frontend.cdx.json secure-cloud-frontend:local

## ------------------------------------------------------ backup and restore
.PHONY: backup
backup: ## Coordinated PostgreSQL + storage backup (root required)
	sudo bash scripts/backup.sh

.PHONY: verify-backup
verify-backup: ## Verify a backup directory: make verify-backup DIR=/srv/secure-cloud-backups/<dir>
	@test -n "$(DIR)" || { echo 'Usage: make verify-backup DIR=/srv/secure-cloud-backups/<dir>'; exit 1; }
	sudo bash scripts/verify-backup.sh "$(DIR)"

.PHONY: restore
restore: ## Restore a backup directory (asks for interactive confirmation)
	@test -n "$(DIR)" || { echo 'Usage: make restore DIR=/srv/secure-cloud-backups/<dir>'; exit 1; }
	sudo bash scripts/restore.sh "$(DIR)"

## -------------------------------------------------------------- infrastructure
.PHONY: tf-init
tf-init: ## Initialise the Terraform working directory
	terraform -chdir=infra init

.PHONY: tf-fmt
tf-fmt: ## Check Terraform formatting
	terraform -chdir=infra fmt -check -recursive

.PHONY: tf-validate
tf-validate: ## Validate the Terraform configuration
	terraform -chdir=infra init -backend=false -input=false
	terraform -chdir=infra validate

.PHONY: tf-plan
tf-plan: ## Plan AWS edge changes into infra/secure-cloud.tfplan
	terraform -chdir=infra plan -out=secure-cloud.tfplan

.PHONY: tf-apply
tf-apply: ## Apply the reviewed Terraform plan
	terraform -chdir=infra apply secure-cloud.tfplan

.PHONY: tf-destroy
tf-destroy: ## Destroy only the AWS edge resources
	terraform -chdir=infra destroy
