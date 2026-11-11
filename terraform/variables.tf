variable "project_name" {
  description = "Base name for all AWS resources created by this module."
  type        = string
  default     = "slack-pokemon"
}

variable "environment" {
  description = "Deployment environment name (e.g., prod, staging, dev)."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region where resources will be provisioned."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones_count" {
  description = "Number of Availability Zones to span (minimum 2 required for ALB and ElastiCache)."
  type        = number
  default     = 2
}

variable "container_image" {
  description = "Optional custom Docker image URI. If empty, defaults to the module-created ECR repository (:latest)."
  type        = string
  default     = ""
}

variable "container_port" {
  description = "Port exposed by the Node.js application container."
  type        = number
  default     = 5000
}

variable "task_cpu" {
  description = "Fargate task CPU units (e.g., 256, 512, 1024)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB (e.g., 1024, 2048)."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired number of running ECS Fargate tasks."
  type        = number
  default     = 1
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN for HTTPS on the ALB. If omitted, CloudFront is used in front of the ALB to provide default HTTPS required by Slack."
  type        = string
  default     = ""
}

variable "enable_cloudfront_https" {
  description = "Create a CloudFront distribution in front of the ALB so Slack receives a valid HTTPS endpoint out-of-the-box without requiring a custom domain."
  type        = bool
  default     = true
}

variable "redis_node_type" {
  description = "ElastiCache node instance type for persistent trainer levels, evolutions, and battle state."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_snapshot_retention_limit" {
  description = "Number of days to retain automated daily ElastiCache backups (ensures permanent trainer progression)."
  type        = number
  default     = 7
}

variable "log_retention_days" {
  description = "CloudWatch log group retention in days."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
