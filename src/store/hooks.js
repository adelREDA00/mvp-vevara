import { useDispatch, useSelector } from 'react-redux'

// Typed hooks - use these instead of useDispatch/useSelector directly
export const useAppDispatch = () => useDispatch()
export const useAppSelector = useSelector

