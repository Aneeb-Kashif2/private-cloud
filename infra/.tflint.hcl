# tflint configuration for the AWS edge module.
#
# `terraform validate` only checks syntax and internal consistency. tflint adds
# provider-aware checks: deprecated arguments, invalid instance types, missing tags and
# naming conventions. The AWS ruleset is downloaded by `tflint --init`.

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

# Documentation and naming are cheap to enforce now and expensive to retrofit later.
rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

rule "terraform_naming_convention" {
  enabled = true
  format  = "snake_case"
}

rule "terraform_typed_variables" {
  enabled = true
}

rule "terraform_unused_declarations" {
  enabled = true
}

# Provider-specific correctness.
rule "aws_instance_invalid_type" {
  enabled = true
}
