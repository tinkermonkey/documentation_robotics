/**
 * Port Allocator for Tests
 * Dynamically allocates available ports to avoid conflicts in parallel test execution
 */

/**
 * Allocates a port from the dynamic port range (40000-50000)
 * Verifies the port is actually available before returning it
 */
export class PortAllocator {
  private usedPorts = new Set<number>();

  /**
   * Allocate an available port
   * @returns Promise that resolves to an available port number
   * @throws Error if unable to allocate a port after 100 attempts
   */
  async allocatePort(): Promise<number> {
    const minPort = 40000;
    const maxPort = 50000;
    let attempts = 0;

    while (attempts < 100) {
      const port = Math.floor(Math.random() * (maxPort - minPort)) + minPort;

      if (!this.usedPorts.has(port)) {
        if (await this.isPortAvailable(port)) {
          this.usedPorts.add(port);
          return port;
        }
      }

      attempts++;
    }

    throw new Error("Could not allocate available port after 100 attempts");
  }

  /**
   * Release a previously allocated port back to the pool
   * @param port The port number to release
   */
  releasePort(port: number): void {
    this.usedPorts.delete(port);
  }

  /**
   * Get all currently allocated ports (useful for debugging)
   */
  getAllocatedPorts(): number[] {
    return Array.from(this.usedPorts).sort((a, b) => a - b);
  }

  /**
   * Check if a port is available by attempting to bind to it
   * @param port Port number to check
   * @returns True if port is available, false otherwise
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      // Create a temporary server to check if the port is available
      const server = Bun.serve({
        port,
        fetch() {
          return new Response();
        },
      });

      // Immediately stop the server
      server.stop(true);

      return true;
    } catch {
      return false;
    }
  }
}

// Export a global instance for use across tests
export const portAllocator = new PortAllocator();
