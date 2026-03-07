import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/client'

export const login = createAsyncThunk(
    'auth/login',
    async ({ email, password }, { rejectWithValue }) => {
        try {
            const data = await api.post('/auth/login', { email, password })
            localStorage.setItem('vevara_user', JSON.stringify(data.user))
            return data
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const register = createAsyncThunk(
    'auth/register',
    async ({ username, email, password }, { rejectWithValue }) => {
        try {
            const data = await api.post('/auth/register', { username, email, password })
            localStorage.setItem('vevara_user', JSON.stringify(data.user))
            return data
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const logoutUser = createAsyncThunk(
    'auth/logout',
    async (_, { rejectWithValue }) => {
        try {
            await api.post('/auth/logout')
            localStorage.removeItem('vevara_user')
            return null
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const checkAuth = createAsyncThunk(
    'auth/check',
    async (_, { rejectWithValue }) => {
        try {
            const data = await api.get('/auth/me')
            localStorage.setItem('vevara_user', JSON.stringify(data.user))
            return data
        } catch (error) {
            localStorage.removeItem('vevara_user')
            return rejectWithValue(error.message)
        }
    }
)

const initialState = {
    user: JSON.parse(localStorage.getItem('vevara_user') || 'null'),
    isAuthenticated: !!localStorage.getItem('vevara_user'),
    status: 'idle',
    error: null,
}

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        clearError: (state) => {
            state.error = null
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(login.pending, (state) => {
                state.status = 'loading'
                state.error = null
            })
            .addCase(login.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.user = action.payload.user
                state.isAuthenticated = true
            })
            .addCase(login.rejected, (state, action) => {
                state.status = 'failed'
                state.error = action.payload
            })
            .addCase(register.pending, (state) => {
                state.status = 'loading'
                state.error = null
            })
            .addCase(register.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.user = action.payload.user
                state.isAuthenticated = true
            })
            .addCase(register.rejected, (state, action) => {
                state.status = 'failed'
                state.error = action.payload
            })
            .addCase(logoutUser.fulfilled, (state) => {
                state.user = null
                state.isAuthenticated = false
                state.status = 'idle'
            })
            .addCase(checkAuth.pending, (state) => {
                state.status = 'loading'
                state.error = null
            })
            .addCase(checkAuth.fulfilled, (state, action) => {
                state.user = action.payload.user
                state.isAuthenticated = true
                state.status = 'succeeded'
            })
            .addCase(checkAuth.rejected, (state) => {
                state.user = null
                state.isAuthenticated = false
                state.status = 'idle'
            })
    },
})

export const { clearError } = authSlice.actions
export default authSlice.reducer
