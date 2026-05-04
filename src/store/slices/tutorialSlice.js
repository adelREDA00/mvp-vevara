import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  active: false,
  step: 0, // 0: off, 1: Animate Button, 2: Element Interaction, 3: Save Step
  isGuest: false,
  hasRunSession: false,
  isInteractionLocked: false,
  autoPlayState: 'none', // 'none', 'initial', 'pending_final', 'final'
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
      if (state.step < 3) {
        state.step += 1;
      }
    },
    endTutorial: (state) => {
      state.active = false;
      state.step = 0;
      state.hasRunSession = true;
    },
    setGuestMode: (state, action) => {
      state.isGuest = action.payload;
    },
    setInteractionLock: (state, action) => {
      state.isInteractionLocked = action.payload;
    },
    setAutoPlayState: (state, action) => {
      state.autoPlayState = action.payload;
    },
    resetTutorialSession: (state) => {
      state.hasRunSession = false;
      state.step = 0;
      state.active = false;
      state.isInteractionLocked = false;
      state.autoPlayState = 'none';
    }
  },
});

export const { startTutorial, nextStep, endTutorial, setGuestMode, setInteractionLock, setAutoPlayState, resetTutorialSession } = tutorialSlice.actions;

export const selectTutorialState = (state) => state.tutorial;

export default tutorialSlice.reducer;
