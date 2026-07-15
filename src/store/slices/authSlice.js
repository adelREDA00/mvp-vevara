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

export const updateUserTheme = createAsyncThunk(
    'auth/updateTheme',
    async (theme, { rejectWithValue }) => {
        try {
            const data = await api.put('/auth/theme', { theme })
            const userString = localStorage.getItem('vevara_user')
            if (userString) {
                const user = JSON.parse(userString)
                user.theme = theme
                localStorage.setItem('vevara_user', JSON.stringify(user))
            }
            return data.user
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const completeOnboarding = createAsyncThunk(
    'auth/completeOnboarding',
    async (_, { rejectWithValue }) => {
        try {
            const data = await api.put('/auth/onboarding', { hasCompletedOnboarding: true })
            const userString = localStorage.getItem('vevara_user')
            if (userString) {
                const user = JSON.parse(userString)
                user.hasCompletedOnboarding = true
                localStorage.setItem('vevara_user', JSON.stringify(user))
            }
            return data.user
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

export const completeExampleIntro = createAsyncThunk(
    'auth/completeExampleIntro',
    async (_, { rejectWithValue }) => {
        try {
            const data = await api.put('/auth/example-intro', { hasSeenExampleProjectIntro: true })
            const userString = localStorage.getItem('vevara_user')
            if (userString) {
                const user = JSON.parse(userString)
                user.hasSeenExampleProjectIntro = true
                localStorage.setItem('vevara_user', JSON.stringify(user))
            }
            return data.user
        } catch (error) {
            return rejectWithValue(error.message)
        }
    }
)

const initialState = {
    user: JSON.parse(localStorage.getItem('vevara_user') || 'null'),
    isAuthenticated: !!localStorage.getItem('vevara_user'),
    status: 'idle',
    error: null,
    migration: {
        isActive: false,
        progress: 0,
        total: 0,
        errors: [],
        completed: false,
        failed: false,
        currentItem: null,
        hasProjects: false,
        hasAssets: false,
    },
}

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        clearError: (state) => {
            state.error = null
        },
        setLocalTheme: (state, action) => {
            if (state.user) {
                state.user.theme = action.payload
                localStorage.setItem('vevara_user', JSON.stringify(state.user))
            }
        },
        startMigration: (state, action) => {
            state.migration.isActive = true
            state.migration.progress = 0
            state.migration.total = action.payload?.total || 0
            state.migration.errors = []
            state.migration.completed = false
            state.migration.failed = false
            state.migration.currentItem = action.payload?.currentItem || null
            state.migration.hasProjects = action.payload?.hasProjects ?? true
            state.migration.hasAssets = action.payload?.hasAssets ?? false
        },
        updateMigrationProgress: (state, action) => {
            state.migration.progress = action.payload.progress ?? state.migration.progress
            state.migration.currentItem = action.payload.currentItem ?? state.migration.currentItem
        },
        migrationComplete: (state, action) => {
            state.migration.isActive = false
            state.migration.completed = true
            state.migration.progress = action.payload?.progress ?? state.migration.total
            state.migration.errors = action.payload?.errors || []
        },
        migrationFailed: (state, action) => {
            state.migration.isActive = false
            state.migration.failed = true
            state.migration.errors = action.payload?.errors || []
        },
        resetMigration: (state) => {
            state.migration = {
                isActive: false,
                progress: 0,
                total: 0,
                errors: [],
                completed: false,
                failed: false,
                currentItem: null,
                hasProjects: false,
                hasAssets: false,
            }
        },
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
                state.migration = initialState.migration
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
            .addCase(updateUserTheme.fulfilled, (state, action) => {
                if (state.user) {
                    state.user.theme = action.payload.theme
                }
            })
            .addCase(completeOnboarding.fulfilled, (state, action) => {
                if (state.user) {
                    state.user.hasCompletedOnboarding = action.payload.hasCompletedOnboarding
                }
            })
            .addCase(completeExampleIntro.fulfilled, (state, action) => {
                if (state.user) {
                    state.user.hasSeenExampleProjectIntro = action.payload.hasSeenExampleProjectIntro
                }
            })
    },
})

export const { clearError, setLocalTheme, startMigration, updateMigrationProgress, migrationComplete, migrationFailed, resetMigration } = authSlice.actions
export default authSlice.reducer