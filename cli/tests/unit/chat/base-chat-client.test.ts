/**
 * Unit tests for BaseChatClient session management
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { BaseChatClient, ChatSession } from '../../../src/ai/base-chat-client';

// Create a concrete test implementation
class TestChatClient extends BaseChatClient {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sendMessage(_message: string): Promise<void> {
    // Create session if it doesn't exist
    if (!this.currentSession) {
      this.createSession();
    }
    this.updateSessionTimestamp();
  }

  getClientName(): string {
    return 'Test Client';
  }

  // Expose protected methods for testing
  public testCreateSession(): ChatSession {
    return this.createSession();
  }

  public testUpdateSessionTimestamp(): void {
    this.updateSessionTimestamp();
  }

  public testGenerateSessionId(): string {
    return this.generateSessionId();
  }
}

describe('BaseChatClient', () => {
  let client: TestChatClient;

  beforeEach(() => {
    client = new TestChatClient();
  });

  describe('session creation', () => {
    it('should create a new session', () => {
      const session = client.testCreateSession();
      
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastMessageAt).toBeInstanceOf(Date);
    });

    it('should generate unique session IDs', () => {
      const id1 = client.testGenerateSessionId();
      const id2 = client.testGenerateSessionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^session-\d+-[a-z0-9]+$/);
    });

    it('should set current session when created', () => {
      expect(client.getCurrentSession()).toBeUndefined();
      
      client.testCreateSession();
      
      expect(client.getCurrentSession()).toBeDefined();
    });
  });

  describe('session management', () => {
    it('should return undefined when no session exists', () => {
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should return current session', () => {
      const session = client.testCreateSession();
      const currentSession = client.getCurrentSession();
      
      expect(currentSession).toBe(session);
    });

    it('should clear session', () => {
      client.testCreateSession();
      expect(client.getCurrentSession()).toBeDefined();
      
      client.clearSession();
      
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should update session timestamp', async () => {
      const session = client.testCreateSession();
      const originalTimestamp = session.lastMessageAt.getTime();
      
      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));
      
      client.testUpdateSessionTimestamp();
      
      const updatedTimestamp = session.lastMessageAt.getTime();
      expect(updatedTimestamp).toBeGreaterThan(originalTimestamp);
    });
  });

  describe('sendMessage', () => {
    it('should create session on first message', async () => {
      expect(client.getCurrentSession()).toBeUndefined();
      
      await client.sendMessage('test message');
      
      expect(client.getCurrentSession()).toBeDefined();
    });

    it('should update timestamp on subsequent messages', async () => {
      await client.sendMessage('first message');
      const session = client.getCurrentSession()!;
      const firstTimestamp = session.lastMessageAt.getTime();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      await client.sendMessage('second message');
      
      const secondTimestamp = session.lastMessageAt.getTime();
      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
    });
  });

  describe('getClientName', () => {
    it('should return client name', () => {
      expect(client.getClientName()).toBe('Test Client');
    });
  });
});
