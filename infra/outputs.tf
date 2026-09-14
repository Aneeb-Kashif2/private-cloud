output "vpc_id" {
  value       = aws_vpc.this.id
  description = "Edge VPC ID."
}
output "public_subnet_id" {
  value       = aws_subnet.public.id
  description = "Public subnet ID."
}
output "private_subnet_id" {
  value       = try(aws_subnet.private[0].id, null)
  description = "Optional private subnet ID."
}
output "security_group_id" {
  value       = aws_security_group.edge.id
  description = "Edge security group ID."
}
output "instance_id" {
  value       = aws_instance.edge.id
  description = "EC2 edge instance ID."
}
output "instance_public_ip" {
  value       = aws_instance.edge.public_ip
  description = "EC2 public IP."
}
output "iam_role_name" {
  value       = aws_iam_role.ec2.name
  description = "EC2 role name."
}
