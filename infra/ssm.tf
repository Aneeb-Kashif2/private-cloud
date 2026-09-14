resource "aws_ssm_association" "ssh_authorized_key" {
  count = var.install_ssh_key_via_ssm && var.ssh_public_key != "" ? 1 : 0
  name  = "AWS-RunShellScript"

  targets {
    key    = "InstanceIds"
    values = [aws_instance.edge.id]
  }

  parameters = {
    commands = join("\n", [
      "install -d -m 700 /home/${var.ssh_user}/.ssh",
      "touch /home/${var.ssh_user}/.ssh/authorized_keys",
      "chmod 600 /home/${var.ssh_user}/.ssh/authorized_keys",
      "grep -qxF '${var.ssh_public_key}' /home/${var.ssh_user}/.ssh/authorized_keys || printf '%s\\n' '${var.ssh_public_key}' >> /home/${var.ssh_user}/.ssh/authorized_keys",
      "chown -R ${var.ssh_user}:${var.ssh_user} /home/${var.ssh_user}/.ssh"
    ])
  }

  depends_on = [aws_iam_role_policy_attachment.ssm]
}
