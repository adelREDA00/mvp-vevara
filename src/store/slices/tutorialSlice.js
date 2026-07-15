import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  active: false,
  step: 0, // 0: off, 1: Create First Moment, 2: Enter Motion Capture, 3: Save Moment, 4: Completion
};

const tutorialSlice = createSlice({
  name: 'tutorial',
  initialState,
  reducers: {
    startTutorial: (state) => {
      state.active = true;
      state.step = 1;
    },
    nextStep: (state) => {
      if (state.step < 4) {
        state.step += 1;
      }
    },
    endTutorial: (state) => {
      state.active = false;
      state.step = 0;
    },
    resetTutorialSession: (state) => {
      state.step = 0;
      state.active = false;
    }
  },
});

export const { startTutorial, nextStep, endTutorial, resetTutorialSession } = tutorialSlice.actions;

export const selectTutorialState = (state) => state.tutorial;

export default tutorialSlice.reducer;
