import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const login = vi.fn().mockResolvedValue({ mfaToken: 'tok' })
const loginMfa = vi.fn().mockResolvedValue(undefined)
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ login, loginMfa }) }))
import Login from './Login'

describe('Login', () => {
  it('asks for the authenticator code after a password step when MFA is enabled', async () => {
    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.co')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret-pass-123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(login).toHaveBeenCalledWith('a@b.co', 'secret-pass-123')
    expect(await screen.findByLabelText(/authenticator code/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/authenticator code/i), '123456')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))
    expect(loginMfa).toHaveBeenCalledWith('tok', '123456')
  })
})
