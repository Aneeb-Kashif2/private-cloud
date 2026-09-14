# Secure Cloud AWS edge infrastructure

This Terraform root module provisions only the public EC2 edge for the split
deployment. It does not provision PostgreSQL, Redis, Fastify, `/srv/secure-cloud-storage`,
S3, EBS data volumes, or the Ubuntu laptop. Those remain on the Ubuntu data-plane
host described in [`../deploy/SPLIT_DEPLOYMENT.md`](../deploy/SPLIT_DEPLOYMENT.md).

Resources created:

- VPC with DNS support, Internet Gateway, public subnet and public route table.
- Optional private subnet and isolated route table reserved for future AWS-only resources.
- EC2 edge instance using the latest Amazon Linux 2023 AMI, encrypted gp3 root disk,
  IMDSv2 required, and no SSH ingress unless explicit trusted CIDRs are supplied.
- Security group allowing HTTP/HTTPS and optional restricted SSH. No database, Redis,
  Fastify or storage ports are opened.
- IAM instance role with SSM management; CloudWatch agent policy/log group are optional.
- Bootstrap installation of Docker, Git, curl, cloudflared and Tailscale. It does not
  join a tailnet unless an optional short-lived auth key is supplied.

## Safe use

Terraform state can contain sensitive values if `tailscale_auth_key` is used. Use a
remote encrypted state backend with locking, or leave that variable empty and enroll
Tailscale through SSM/manual setup. Never commit `terraform.tfvars`, state files,
Cloudflare tokens, database credentials or application secrets.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit region, instance type, key name and restricted SSH CIDRs if needed.
terraform init
terraform fmt -check
terraform validate
terraform plan -out secure-cloud.tfplan
terraform apply secure-cloud.tfplan
terraform output
```

The AWS provider uses the normal AWS credential chain (`AWS_PROFILE`, environment
credentials or an attached local profile). Terraform does not invent or store AWS
credentials. Review the plan before applying. `assign_public_ip` defaults to true so
the EC2 host can bootstrap and run the outbound named Cloudflare Tunnel; set it false
only when you provide another private egress path.

## After apply

1. Register/authenticate Tailscale on EC2 and the Ubuntu laptop. Enable MagicDNS and
   place the laptop hostname in `deploy/ec2/.env` as `UBUNTU_TAILSCALE_HOST`.
2. Restrict the Tailscale ACL and Ubuntu firewall so only EC2 can reach Ubuntu TCP 8080.
3. Create a named Cloudflare Tunnel and attach its custom hostname to EC2's local
   `http://127.0.0.1:8080` origin. Put its token in the mode-0600 file referenced by
   `CLOUDFLARE_TUNNEL_TOKEN_FILE`.
4. Deploy the EC2 frontend/Nginx stack from `deploy/ec2` and the Ubuntu data-plane
   stack from `deploy/ubuntu`.
5. Verify the private health path from EC2, then verify the public hostname. Do not
   expose Ubuntu's PostgreSQL, Redis or Fastify listeners through AWS security groups,
   router forwarding or Cloudflare.

## Destroy

`terraform destroy` removes the AWS VPC, EC2 edge, IAM profile and optional CloudWatch
log group created by this module. It does not touch the Ubuntu laptop, its database,
Redis data or local file storage. Confirm the plan carefully before destroying a
production edge host.
