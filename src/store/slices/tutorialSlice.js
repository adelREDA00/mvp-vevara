import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  active: false,
  step: 0, // 0: off, 1: Play Animation, 2: Explain Steps, 3: Add Step 3, 4: Edit Shape, 5: Save Step 3, 6: Finished
  isGuest: false,
  hasRunSession: false, // Track if it ran in this session
};

const tutorialSlice = createSlice({
  name: 'tutorial',
  initialState,
  reducers: {
    startTutorial: (state) => {
      if (!state.hasRunSession) {
        state.active = true;
        state.step = 1;
      }
    },
    nextStep: (state) => {
      if (state.step < 6) {
        state.step += 1;
      }
      if (state.step === 6) {
        state.active = false;
        state.hasRunSession = true;
      }
    },
    endTutorial: (state) => {
      state.active = false;
      state.step = 3;
      state.hasRunSession = true;
    },
    setGuestMode: (state, action) => {
      state.isGuest = action.payload;
    },
    resetTutorialSession: (state) => {
      state.hasRunSession = false;
      state.step = 0;
      state.active = false;
    }
  },
});

export const { startTutorial, nextStep, endTutorial, setGuestMode, resetTutorialSession } = tutorialSlice.actions;

export const selectTutorialState = (state) => state.tutorial;

export default tutorialSlice.reducer;
