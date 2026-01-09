/**
 * Unit tests for source reference functionality
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Element } from '../../src/core/element';
import type { SourceReference, SourceLocation, RepositoryContext, ProvenanceType } from '../../src/types/source-reference';

describe('SourceReference Types', () => {
  describe('SourceLocation', () => {
    it('should create a SourceLocation with file only', () => {
      const location: SourceLocation = {
        file: 'src/services/auth.ts',
      };
      expect(location.file).toBe('src/services/auth.ts');
      expect(location.symbol).toBeUndefined();
    });

    it('should create a SourceLocation with file and symbol', () => {
      const location: SourceLocation = {
        file: 'src/services/auth.ts',
        symbol: 'AuthService.login',
      };
      expect(location.file).toBe('src/services/auth.ts');
      expect(location.symbol).toBe('AuthService.login');
    });
  });

  describe('RepositoryContext', () => {
    it('should create a RepositoryContext with URL only', () => {
      const context: RepositoryContext = {
        url: 'https://github.com/example/repo.git',
      };
      expect(context.url).toBe('https://github.com/example/repo.git');
      expect(context.commit).toBeUndefined();
    });

    it('should create a RepositoryContext with commit only', () => {
      const context: RepositoryContext = {
        commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b',
      };
      expect(context.commit).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b');
      expect(context.url).toBeUndefined();
    });

    it('should create a RepositoryContext with both URL and commit', () => {
      const context: RepositoryContext = {
        url: 'https://github.com/example/repo.git',
        commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b',
      };
      expect(context.url).toBe('https://github.com/example/repo.git');
      expect(context.commit).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b');
    });
  });

  describe('SourceReference', () => {
    it('should create a basic SourceReference with single location', () => {
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/main.ts' }],
      };
      expect(reference.provenance).toBe('manual');
      expect(reference.locations).toHaveLength(1);
      expect(reference.locations[0].file).toBe('src/main.ts');
      expect(reference.repository).toBeUndefined();
    });

    it('should create a SourceReference with multiple locations', () => {
      const reference: SourceReference = {
        provenance: 'extracted',
        locations: [
          { file: 'src/services/auth.ts', symbol: 'AuthService' },
          { file: 'src/services/auth-utils.ts', symbol: 'validateToken' },
        ],
      };
      expect(reference.provenance).toBe('extracted');
      expect(reference.locations).toHaveLength(2);
    });

    it('should create a SourceReference with repository context', () => {
      const reference: SourceReference = {
        provenance: 'inferred',
        locations: [{ file: 'src/main.ts' }],
        repository: {
          url: 'https://github.com/example/repo.git',
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b',
        },
      };
      expect(reference.repository?.url).toBe('https://github.com/example/repo.git');
      expect(reference.repository?.commit).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b');
    });

    it('should support all ProvenanceType values', () => {
      const provenances: ProvenanceType[] = ['extracted', 'manual', 'inferred', 'generated'];
      provenances.forEach((provenance) => {
        const reference: SourceReference = {
          provenance,
          locations: [{ file: 'src/main.ts' }],
        };
        expect(reference.provenance).toBe(provenance);
      });
    });
  });
});

describe('Element Source Reference Methods', () => {
  let element: Element;

  beforeEach(() => {
    element = new Element({
      id: 'api-endpoint-create-user',
      type: 'APIEndpoint',
      name: 'Create User',
      layer: '06-api',
    });
  });

  describe('getSourceReference() for OpenAPI layers (06-08)', () => {
    it('should return undefined when no source reference exists', () => {
      expect(element.getSourceReference()).toBeUndefined();
    });

    it('should return source reference from x-source-reference property for layer 06', () => {
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/routes/users.ts', symbol: 'POST /users' }],
      };
      element.properties['x-source-reference'] = reference;

      const result = element.getSourceReference();
      expect(result).toEqual(reference);
      expect(result?.provenance).toBe('manual');
      expect(result?.locations[0].file).toBe('src/routes/users.ts');
    });

    it('should return source reference from x-source-reference for layer 07', () => {
      element.layer = '07-data-model';
      const reference: SourceReference = {
        provenance: 'extracted',
        locations: [{ file: 'src/models/user.ts', symbol: 'User' }],
      };
      element.properties['x-source-reference'] = reference;

      expect(element.getSourceReference()).toEqual(reference);
    });

    it('should return source reference from x-source-reference for layer 08', () => {
      element.layer = '08-datastore';
      const reference: SourceReference = {
        provenance: 'generated',
        locations: [{ file: 'migrations/001_create_users.sql' }],
      };
      element.properties['x-source-reference'] = reference;

      expect(element.getSourceReference()).toEqual(reference);
    });
  });

  describe('getSourceReference() for ArchiMate layers (non-06-08)', () => {
    it('should return undefined when no source reference exists for layer 01', () => {
      element.layer = '01-motivation';
      expect(element.getSourceReference()).toBeUndefined();
    });

    it('should return source reference from properties.source.reference for layer 01', () => {
      element.layer = '01-motivation';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'requirements.md' }],
      };
      element.properties.source = { reference };

      expect(element.getSourceReference()).toEqual(reference);
    });

    it('should return source reference from properties.source.reference for layer 04', () => {
      element.layer = '04-application';
      const reference: SourceReference = {
        provenance: 'inferred',
        locations: [{ file: 'src/services/auth.ts', symbol: 'AuthService' }],
      };
      element.properties.source = { reference };

      expect(element.getSourceReference()).toEqual(reference);
    });

    it('should return undefined when properties.source exists but no reference', () => {
      element.layer = '04-application';
      element.properties.source = { someOtherField: 'value' };

      expect(element.getSourceReference()).toBeUndefined();
    });

    it('should handle undefined properties.source gracefully', () => {
      element.layer = '04-application';
      element.properties.source = undefined;

      expect(element.getSourceReference()).toBeUndefined();
    });
  });

  describe('setSourceReference() for OpenAPI layers (06-08)', () => {
    it('should set source reference to x-source-reference for layer 06', () => {
      element.layer = '06-api';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/routes/users.ts' }],
      };

      element.setSourceReference(reference);
      expect(element.properties['x-source-reference']).toEqual(reference);
    });

    it('should set source reference to x-source-reference for layer 07', () => {
      element.layer = '07-data-model';
      const reference: SourceReference = {
        provenance: 'extracted',
        locations: [{ file: 'src/models/user.ts' }],
      };

      element.setSourceReference(reference);
      expect(element.properties['x-source-reference']).toEqual(reference);
    });

    it('should set source reference to x-source-reference for layer 08', () => {
      element.layer = '08-datastore';
      const reference: SourceReference = {
        provenance: 'generated',
        locations: [{ file: 'migrations/001_create_users.sql' }],
      };

      element.setSourceReference(reference);
      expect(element.properties['x-source-reference']).toEqual(reference);
    });

    it('should overwrite existing x-source-reference', () => {
      element.layer = '06-api';
      const oldReference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'old.ts' }],
      };
      const newReference: SourceReference = {
        provenance: 'extracted',
        locations: [{ file: 'new.ts' }],
      };

      element.setSourceReference(oldReference);
      expect(element.properties['x-source-reference']).toEqual(oldReference);

      element.setSourceReference(newReference);
      expect(element.properties['x-source-reference']).toEqual(newReference);
    });
  });

  describe('setSourceReference() for ArchiMate layers (non-06-08)', () => {
    it('should set source reference to properties.source.reference for layer 01', () => {
      element.layer = '01-motivation';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'requirements.md' }],
      };

      element.setSourceReference(reference);
      expect((element.properties.source as any).reference).toEqual(reference);
    });

    it('should create properties.source if it does not exist', () => {
      element.layer = '04-application';
      expect(element.properties.source).toBeUndefined();

      const reference: SourceReference = {
        provenance: 'inferred',
        locations: [{ file: 'src/services/auth.ts' }],
      };
      element.setSourceReference(reference);

      expect(element.properties.source).toBeDefined();
      expect((element.properties.source as any).reference).toEqual(reference);
    });

    it('should preserve existing properties.source fields when setting reference', () => {
      element.layer = '04-application';
      element.properties.source = { someField: 'value' };

      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/main.ts' }],
      };
      element.setSourceReference(reference);

      expect((element.properties.source as any).someField).toBe('value');
      expect((element.properties.source as any).reference).toEqual(reference);
    });

    it('should overwrite existing reference in properties.source', () => {
      element.layer = '04-application';
      const oldReference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'old.ts' }],
      };
      const newReference: SourceReference = {
        provenance: 'extracted',
        locations: [{ file: 'new.ts' }],
      };

      element.setSourceReference(oldReference);
      expect((element.properties.source as any).reference).toEqual(oldReference);

      element.setSourceReference(newReference);
      expect((element.properties.source as any).reference).toEqual(newReference);
    });
  });

  describe('setSourceReference() error handling', () => {
    it('should throw error when element has no layer assigned', () => {
      element.layer = undefined;
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/main.ts' }],
      };

      expect(() => element.setSourceReference(reference)).toThrow(
        'Cannot set source reference: element has no layer assigned'
      );
    });
  });

  describe('hasSourceReference()', () => {
    it('should return false when no source reference exists', () => {
      expect(element.hasSourceReference()).toBe(false);
    });

    it('should return true when source reference exists for OpenAPI layer', () => {
      element.layer = '06-api';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/main.ts' }],
      };
      element.properties['x-source-reference'] = reference;

      expect(element.hasSourceReference()).toBe(true);
    });

    it('should return true when source reference exists for ArchiMate layer', () => {
      element.layer = '04-application';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'src/main.ts' }],
      };
      element.properties.source = { reference };

      expect(element.hasSourceReference()).toBe(true);
    });

    it('should return false when properties.source exists but no reference for ArchiMate layer', () => {
      element.layer = '04-application';
      element.properties.source = { someField: 'value' };

      expect(element.hasSourceReference()).toBe(false);
    });
  });

  describe('Layer-aware behavior across different layers', () => {
    it('should use x-source-reference for layer 06', () => {
      element.layer = '06-api';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'api.ts' }],
      };

      element.setSourceReference(reference);
      expect(element.getSourceReference()).toEqual(reference);
      expect(element.properties['x-source-reference']).toEqual(reference);
      expect((element.properties.source as any)?.reference).toBeUndefined();
    });

    it('should use properties.source.reference for layer 01', () => {
      element.layer = '01-motivation';
      const reference: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'main.ts' }],
      };

      element.setSourceReference(reference);
      expect(element.getSourceReference()).toEqual(reference);
      expect((element.properties.source as any).reference).toEqual(reference);
      expect(element.properties['x-source-reference']).toBeUndefined();
    });

    it('should switch storage correctly when layer changes', () => {
      // Start with layer 06 (OpenAPI)
      element.layer = '06-api';
      const ref1: SourceReference = {
        provenance: 'manual',
        locations: [{ file: 'api.ts' }],
      };
      element.setSourceReference(ref1);
      expect(element.properties['x-source-reference']).toEqual(ref1);

      // Change to layer 04 (ArchiMate)
      element.layer = '04-application';
      const ref2: SourceReference = {
        provenance: 'extracted',
        locations: [{ file: 'app.ts' }],
      };
      element.setSourceReference(ref2);

      // New layer should have reference in its storage location
      expect((element.properties.source as any).reference).toEqual(ref2);
      // Old reference should still be there (not cleaned up by setSourceReference)
      expect(element.properties['x-source-reference']).toEqual(ref1);
    });
  });
});
