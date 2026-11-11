# AWS ECS + Persistent ElastiCache Terraform Module

This Terraform module deploys **Slack-Pokemon** on AWS with permanent storage for trainer rosters, Pokémon levels, XP, wins, and evolutions:

- **Amazon ECS (Fargate):** Runs the containerized Node.js application and dynamic composite battle card renderer (`@napi-rs/canvas` + `gifenc`).
- **Amazon ElastiCache (Valkey/Redis):** Deployed in private subnets with encryption at rest and daily automated snapshots (`redis_snapshot_retention_limit`), ensuring all trainer levels, rosters, and evolutions are retained permanently across container restarts and deployments.
- **Application Load Balancer (ALB) + CloudFront HTTPS:** Slack requires `https://` URLs for Slash Commands, Interactive Buttons, and battle card image unfurling. By default (`enable_cloudfront_https = true`), this module provisions a CloudFront distribution in front of the ALB so you get a working `https://*.cloudfront.net` URL out of the box without needing a custom domain or ACM certificate.
- **Amazon ECR & CloudWatch Logs:** Provisions a container registry and log group.

## Usage as a Module

```hcl
provider "aws" {
  region = "us-east-1"
}

module "slack_pokemon" {
  source = "./terraform"

  project_name = "slack-pokemon"
  environment  = "prod"
  aws_region   = "us-east-1"
}

output "slack_slash_command_url" {
  value = module.slack_pokemon.slack_slash_command_url
}

output "slack_interactivity_url" {
  value = module.slack_pokemon.slack_interactivity_url
}

output "ecr_repository_url" {
  value = module.slack_pokemon.ecr_repository_url
}
```

## Deployment Steps

1. **Provision Infrastructure:**
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```

2. **Build & Push the Docker Image to ECR:**
   ```bash
   ECR_URL=$(terraform -chdir=terraform output -raw ecr_repository_url)
   AWS_REGION="us-east-1"

   aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URL
   docker build -t slack-pokemon .
   docker tag slack-pokemon:latest $ECR_URL:latest
   docker push $ECR_URL:latest
   ```

3. **Force ECS Service Rollout (if updating an existing image):**
   ```bash
   aws ecs update-service \
     --cluster $(terraform -chdir=terraform output -raw ecs_cluster_name) \
     --service $(terraform -chdir=terraform output -raw ecs_service_name) \
     --force-new-deployment
   ```

4. **Configure Slack:**
   Use the Terraform outputs `slack_slash_command_url` (`/commands`) and `slack_interactivity_url` (`/interactions`) in your Slack App (or import `slack-app-manifest.json` at [api.slack.com/apps](https://api.slack.com/apps)).
