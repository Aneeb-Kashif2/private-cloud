variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for the EC2 edge host."
}
variable "project_name" {
  type        = string
  default     = "secure-cloud"
  description = "Resource name prefix."
}
variable "environment" {
  type        = string
  default     = "production"
  description = "Deployment environment."
}
variable "vpc_cidr" {
  type        = string
  default     = "10.42.0.0/16"
  description = "Edge VPC CIDR."
}
variable "public_subnet_cidr" {
  type        = string
  default     = "10.42.1.0/24"
  description = "Public subnet CIDR."
}
variable "private_subnet_cidr" {
  type        = string
  default     = "10.42.2.0/24"
  description = "Optional private subnet CIDR."
}
variable "create_private_subnet" {
  type        = bool
  default     = true
  description = "Create a reserved private subnet."
}
variable "availability_zone" {
  type        = string
  default     = ""
  description = "Optional AZ; empty selects the first available AZ."
}
variable "instance_type" {
  type        = string
  default     = "t3.micro"
  description = "EC2 edge instance type."
}
variable "ssh_key_name" {
  type        = string
  default     = ""
  description = "Existing EC2 key pair; empty disables SSH key injection."
}
variable "ssh_public_key" {
  type        = string
  default     = ""
  description = "OpenSSH public key used to create the EC2 key pair. Never provide the private key."
}
variable "ssh_key_pair_name" {
  type        = string
  default     = "secure-cloud-edge"
  description = "AWS key-pair name created when ssh_public_key is supplied."
}
variable "ssh_allowed_cidrs" {
  type        = list(string)
  default     = ["203.99.54.234/32"]
  description = "Trusted SSH CIDRs; empty disables SSH ingress."
}
variable "assign_public_ip" {
  type        = bool
  default     = true
  description = "Assign a public IPv4 address."
}
variable "enable_cloudwatch" {
  type        = bool
  default     = false
  description = "Install and permit the CloudWatch agent."
}
variable "cloudwatch_log_group_name" {
  type        = string
  default     = "/secure-cloud/ec2"
  description = "CloudWatch log group name."
}
variable "tailscale_auth_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Optional short-lived Tailscale auth key; stored in state if supplied."
}
variable "tailscale_hostname" {
  type        = string
  default     = "secure-cloud-ec2"
  description = "EC2 Tailscale hostname."
}
variable "tags" {
  type        = map(string)
  default     = {}
  description = "Additional tags."
}
