from services.dev_container_state import dev_container_state, DevContainerStatus

project_name = "documentation_robotics"  # Using the actual project name from the issue
image_name = f"{project_name}-agent:latest"

dev_container_state.set_status(
    project_name=project_name,
    status=DevContainerStatus.VERIFIED,
    image_name=image_name
)

print(f"✓ Marked {project_name} dev container as VERIFIED")
