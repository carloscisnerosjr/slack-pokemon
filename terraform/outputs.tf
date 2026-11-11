output "ecr_repository_url" {
  description = "ECR repository URL where the Docker image should be pushed."
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer."
  value       = aws_lb.app.dns_name
}

output "public_https_url" {
  description = "Base HTTPS URL for the deployment (used for PUBLIC_URL and Slack webhooks)."
  value       = local.public_base_url
}

output "slack_slash_command_url" {
  description = "URL to configure in Slack Slash Commands (/pkmn)."
  value       = "${local.public_base_url}/commands"
}

output "slack_interactivity_url" {
  description = "URL to configure in Slack Interactivity & Shortcuts for clickable move buttons."
  value       = "${local.public_base_url}/interactions"
}

output "redis_endpoint" {
  description = "Primary endpoint of the persistent ElastiCache Valkey/Redis instance."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster running the service."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the ECS Fargate service."
  value       = aws_ecs_service.app.name
}
