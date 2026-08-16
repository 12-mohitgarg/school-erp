import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import { api } from '@/lib/api';
import authReducer from './authSlice';
import uiReducer from './uiSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: {
        // RTK Query stores Dates/errors in its internal actions; checking them
        // is pure overhead in development.
        ignoredActions: ['api/executeQuery/fulfilled', 'api/executeMutation/fulfilled'],
      },
    }).concat(api.middleware),
  devTools: import.meta.env.DEV,
});

// Enables refetchOnFocus / refetchOnReconnect.
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
