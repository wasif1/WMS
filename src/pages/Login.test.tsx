import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const state: any = { notice: null }
const login = vi.fn(), loginMfa = vi.fn(), clearNotice = vi.fn()
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ login, loginMfa, notice: state.notice, clearNotice }) }))
import Login from './Login'

const signIn = async () => {
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.co'); await userEvent.type(screen.getByLabelText(/password/i), 'secret-pass-123')
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
}
beforeEach(() => { vi.clearAllMocks(); state.notice = null; login.mockResolvedValue({ mfaToken: 'tok' }); loginMfa.mockResolvedValue(undefined) })

describe('Login', () => {
  it('asks for the authenticator code after a password step when MFA is enabled', async () => {
    render(<Login />); await signIn()
    expect(login).toHaveBeenCalledWith('a@b.co', 'secret-pass-123')
    expect(await screen.findByLabelText(/authenticator code/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/authenticator code/i), '123456'); await userEvent.click(screen.getByRole('button', { name: /verify/i }))
    expect(loginMfa).toHaveBeenCalledWith('tok', '123456')
  })
  it('explains why the user was signed out (session expired)', () => {
    state.notice = 'Your session has ended, so we signed you out to keep your data safe. Please sign in again.'
    render(<Login />); expect(screen.getByRole('status')).toHaveTextContent('we signed you out to keep your data safe')
  })
  it('a wrong password shows the server message with the lockout rule', async () => {
    login.mockRejectedValue(new ApiError(401, 'Incorrect email or password. For security, an account is locked for 15 minutes after 5 wrong attempts.', 'invalid_credentials'))
    render(<Login />); await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed'); expect(screen.getByRole('alert')).toHaveTextContent('locked for 15 minutes after 5 wrong attempts')
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('an unreachable server says so instead of "Failed to fetch"', async () => {
    login.mockRejectedValue(new ApiError(0, 'Network error', 'network'))
    render(<Login />); await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server"); expect(document.body.textContent).not.toMatch(/Failed to fetch|Network error/)
  })
  it('too many attempts shows the rate-limit message', async () => {
    login.mockRejectedValue(new ApiError(429, 'Too many sign-in attempts. Please wait about 15 minutes and try again.', 'rate_limited'))
    render(<Login />); await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts')
  })
})
