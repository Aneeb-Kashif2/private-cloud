resource "aws_cloudwatch_log_group" "ec2" {
  count             = var.enable_cloudwatch ? 1 : 0
  name              = var.cloudwatch_log_group_name
  retention_in_days = 14
}
