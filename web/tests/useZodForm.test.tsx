import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoginRequestSchema, RegisterRequestSchema } from '@scpsl-trust/shared';

import { ApiError } from '../src/api/client';
import { useZodForm } from '../src/components/useZodForm';

describe('useZodForm', () => {
  it('validates with the shared schema and reports field errors', () => {
    const { result } = renderHook(() => useZodForm({ schema: LoginRequestSchema, initialValues: { email: 'nope', password: '' } }));
    let parsed: unknown = undefined;
    act(() => {
      parsed = result.current.validate();
    });
    expect(parsed).toBeNull();
    expect(result.current.errors.email).toBeDefined();
    expect(result.current.errors.password).toBeDefined();
  });

  it('returns parsed values (with transforms) when valid', () => {
    const { result } = renderHook(() => useZodForm({ schema: LoginRequestSchema, initialValues: { email: '  User@Example.org ', password: 'secret123' } }));
    let parsed: unknown = undefined;
    act(() => {
      parsed = result.current.validate();
    });
    expect(parsed).toEqual({ email: 'user@example.org', password: 'secret123' });
    expect(result.current.errors).toEqual({});
  });

  it('clears a field error when the field changes', () => {
    const { result } = renderHook(() => useZodForm({ schema: LoginRequestSchema, initialValues: { email: 'x', password: 'y' } }));
    act(() => {
      result.current.validate();
    });
    expect(result.current.errors.email).toBeDefined();
    act(() => {
      result.current.setValue('email', 'a@b.co');
    });
    expect(result.current.errors.email).toBeUndefined();
  });

  it('maps server validation issues to fields (stripping the body. prefix)', () => {
    const { result } = renderHook(() =>
      useZodForm({ schema: RegisterRequestSchema, initialValues: { email: 'a@b.co', username: 'abc', password: 'longenoughpw' } }),
    );
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: [
        { path: 'body.username', message: 'Username already taken' },
        { path: 'email', message: 'Email already registered' },
        { path: 'body.something.else', message: 'Unknown field' },
      ],
    });
    let matched = false;
    act(() => {
      matched = result.current.applyApiError(error);
    });
    expect(matched).toBe(true);
    expect(result.current.errors.username).toBe('Username already taken');
    expect(result.current.errors.email).toBe('Email already registered');
    expect(result.current.formError).toBe('something.else: Unknown field');
  });

  it('keeps non-validation errors as the form error', () => {
    const { result } = renderHook(() => useZodForm({ schema: LoginRequestSchema, initialValues: { email: 'a@b.co', password: 'x' } }));
    const error = new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    act(() => {
      result.current.applyApiError(error);
    });
    expect(result.current.formError).toBe(error);
    expect(result.current.errors).toEqual({});
  });

  it('handleSubmit validates, calls onSubmit and maps thrown ApiErrors', async () => {
    const onSubmit = vi.fn(async () => {
      throw new ApiError({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'bad',
        details: [{ path: 'password', message: 'Too weak' }],
      });
    });
    const { result } = renderHook(() => useZodForm({ schema: LoginRequestSchema, initialValues: { email: 'a@b.co', password: 'pw' }, onSubmit }));
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' });
    expect(result.current.errors.password).toBe('Too weak');
    expect(result.current.submitting).toBe(false);
  });

  it('exposes field bindings with ids and values', () => {
    const { result } = renderHook(() => useZodForm({ schema: LoginRequestSchema, initialValues: { email: 'a@b.co', password: '' } }));
    const binding = result.current.field('email');
    expect(binding.name).toBe('email');
    expect(binding.value).toBe('a@b.co');
    expect(binding.id).toContain('email');
  });
});
