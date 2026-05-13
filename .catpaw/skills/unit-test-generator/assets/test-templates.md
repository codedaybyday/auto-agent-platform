# 测试模板参考

本文档提供各框架的 Jest 测试模板，供 `unit-test-generator` skill 生成测试文件时参考。

---

## 一、React 组件测试模板

### 基础组件测试

```typescript
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserCard } from '@/components/UserCard'

// Mock 外部依赖
jest.mock('@/api/user', () => ({
  getUserInfo: jest.fn(),
}))
import { getUserInfo } from '@/api/user'
const mockGetUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>

// 测试数据工厂
const createMockUser = (overrides = {}) => ({
  id: 1,
  name: '张三',
  avatar: 'https://example.com/avatar.jpg',
  role: 'admin',
  ...overrides,
})

describe('UserCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('渲染', () => {
    it('should render user info correctly', () => {
      const user = createMockUser()
      render(<UserCard user={user} />)

      expect(screen.getByText('张三')).toBeInTheDocument()
      expect(screen.getByRole('img')).toHaveAttribute('src', user.avatar)
    })

    it('should render empty state when user is null', () => {
      render(<UserCard user={null} />)
      expect(screen.getByText('暂无数据')).toBeInTheDocument()
    })
  })

  describe('交互', () => {
    it('should call onEdit when edit button clicked', async () => {
      const onEdit = jest.fn()
      const user = createMockUser()
      render(<UserCard user={user} onEdit={onEdit} />)

      await userEvent.click(screen.getByRole('button', { name: '编辑' }))
      expect(onEdit).toHaveBeenCalledWith(user.id)
    })
  })

  describe('异步加载', () => {
    it('should show loading state while fetching', async () => {
      mockGetUserInfo.mockImplementation(() => new Promise(() => {})) // 永不 resolve
      render(<UserCard userId={1} />)

      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    })

    it('should render data after fetch success', async () => {
      mockGetUserInfo.mockResolvedValue(createMockUser())
      render(<UserCard userId={1} />)

      await waitFor(() => {
        expect(screen.getByText('张三')).toBeInTheDocument()
      })
    })

    it('should show error message when fetch fails', async () => {
      mockGetUserInfo.mockRejectedValue(new Error('Network Error'))
      render(<UserCard userId={1} />)

      await waitFor(() => {
        expect(screen.getByText('加载失败，请重试')).toBeInTheDocument()
      })
    })
  })
})
```

### 带路由的组件测试

```typescript
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = jest.fn()
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: '123' }),
}))

// 渲染时包裹路由
render(
  <MemoryRouter>
    <MyComponent />
  </MemoryRouter>
)
```

### 带 Redux Store 的组件测试

```typescript
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import userReducer from '@/store/userSlice'

const createTestStore = (preloadedState = {}) =>
  configureStore({
    reducer: { user: userReducer },
    preloadedState,
  })

const renderWithStore = (ui: React.ReactElement, preloadedState = {}) => {
  const store = createTestStore(preloadedState)
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  }
}

it('should display user name from store', () => {
  renderWithStore(<UserProfile />, {
    user: { currentUser: { name: '张三' } },
  })
  expect(screen.getByText('张三')).toBeInTheDocument()
})
```

---

## 二、Vue 3 组件测试模板

```typescript
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import UserCard from '@/components/UserCard.vue'

jest.mock('@/api/user', () => ({
  getUserInfo: jest.fn(),
}))
import { getUserInfo } from '@/api/user'
const mockGetUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>

describe('UserCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.clearAllMocks()
  })

  it('should render user info correctly', () => {
    const wrapper = mount(UserCard, {
      props: { userId: 1, name: '张三' },
    })
    expect(wrapper.text()).toContain('张三')
  })

  it('should emit edit event when button clicked', async () => {
    const wrapper = mount(UserCard, { props: { userId: 1 } })
    await wrapper.find('[data-testid="edit-btn"]').trigger('click')
    expect(wrapper.emitted('edit')).toBeTruthy()
    expect(wrapper.emitted('edit')![0]).toEqual([1])
  })

  it('should fetch and display data on mount', async () => {
    mockGetUserInfo.mockResolvedValue({ id: 1, name: '张三' })
    const wrapper = mount(UserCard, { props: { userId: 1 } })

    await flushPromises()
    expect(wrapper.text()).toContain('张三')
  })

  it('should show error when fetch fails', async () => {
    mockGetUserInfo.mockRejectedValue(new Error('Network Error'))
    const wrapper = mount(UserCard, { props: { userId: 1 } })

    await flushPromises()
    expect(wrapper.find('.error-message').exists()).toBe(true)
  })
})
```

---

## 三、React Hooks 测试模板

```typescript
import { renderHook, act, waitFor } from '@testing-library/react'
import { useUserInfo } from '@/hooks/useUserInfo'

jest.mock('@/api/user')
import { getUserInfo } from '@/api/user'
const mockGetUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>

describe('useUserInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return initial state', () => {
    const { result } = renderHook(() => useUserInfo(1))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('should fetch and return user data', async () => {
    mockGetUserInfo.mockResolvedValue({ id: 1, name: '张三' })
    const { result } = renderHook(() => useUserInfo(1))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data).toEqual({ id: 1, name: '张三' })
  })

  it('should set error state when fetch fails', async () => {
    mockGetUserInfo.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(() => useUserInfo(1))

    await waitFor(() => {
      expect(result.current.error).toBeTruthy()
    })
    expect(result.current.data).toBeNull()
  })

  it('should refetch when userId changes', async () => {
    mockGetUserInfo.mockResolvedValue({ id: 1, name: '张三' })
    const { rerender } = renderHook(({ id }) => useUserInfo(id), {
      initialProps: { id: 1 },
    })

    await waitFor(() => expect(mockGetUserInfo).toHaveBeenCalledWith(1))

    rerender({ id: 2 })
    await waitFor(() => expect(mockGetUserInfo).toHaveBeenCalledWith(2))
  })
})
```

---

## 四、工具函数测试模板

```typescript
import { formatDate, formatPrice, validateEmail } from '@/utils/format'

describe('formatDate', () => {
  it('should format date correctly', () => {
    expect(formatDate(new Date('2024-01-15'))).toBe('2024-01-15')
  })

  it('should handle invalid date', () => {
    expect(formatDate(new Date('invalid'))).toBe('-')
  })

  it('should handle null/undefined', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate(undefined)).toBe('-')
  })

  // 参数化测试
  it.each([
    [new Date('2024-01-01'), '2024-01-01'],
    [new Date('2024-12-31'), '2024-12-31'],
    [new Date('2024-02-29'), '2024-02-29'], // 闰年
  ])('formatDate(%s) should return %s', (input, expected) => {
    expect(formatDate(input)).toBe(expected)
  })
})

describe('validateEmail', () => {
  it('should return true for valid email', () => {
    expect(validateEmail('user@example.com')).toBe(true)
  })

  it.each([
    [''],
    ['not-an-email'],
    ['@example.com'],
    ['user@'],
    ['user @example.com'],
  ])('should return false for invalid email: %s', (email) => {
    expect(validateEmail(email)).toBe(false)
  })
})
```

---

## 五、Pinia Store 测试模板

```typescript
import { setActivePinia, createPinia } from 'pinia'
import { useUserStore } from '@/store/userStore'

jest.mock('@/api/user')
import { getUserInfo, updateUser } from '@/api/user'
const mockGetUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>
const mockUpdateUser = updateUser as jest.MockedFunction<typeof updateUser>

describe('useUserStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.clearAllMocks()
  })

  it('should have correct initial state', () => {
    const store = useUserStore()
    expect(store.currentUser).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('should fetch and set user', async () => {
    mockGetUserInfo.mockResolvedValue({ id: 1, name: '张三' })
    const store = useUserStore()

    await store.fetchUser(1)
    expect(store.currentUser).toEqual({ id: 1, name: '张三' })
    expect(store.loading).toBe(false)
  })

  it('should set error when fetch fails', async () => {
    mockGetUserInfo.mockRejectedValue(new Error('Network Error'))
    const store = useUserStore()

    await store.fetchUser(1)
    expect(store.error).toBeTruthy()
    expect(store.currentUser).toBeNull()
  })

  it('should compute isAdmin correctly', () => {
    const store = useUserStore()
    store.currentUser = { id: 1, name: '张三', role: 'admin' }
    expect(store.isAdmin).toBe(true)

    store.currentUser.role = 'user'
    expect(store.isAdmin).toBe(false)
  })
})
```

---

## 六、定时器和异步测试

```typescript
describe('debounced search', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should only call search once after debounce delay', async () => {
    const mockSearch = jest.fn()
    const { result } = renderHook(() => useDebouncedSearch(mockSearch, 300))

    act(() => {
      result.current.search('a')
      result.current.search('ab')
      result.current.search('abc')
    })

    expect(mockSearch).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch).toHaveBeenCalledWith('abc')
  })
})
```

---

## 七、常用 Jest Matcher 速查

```typescript
// DOM 断言（需要 @testing-library/jest-dom）
expect(element).toBeInTheDocument()
expect(element).toBeVisible()
expect(element).toBeDisabled()
expect(element).toHaveTextContent('文本')
expect(element).toHaveAttribute('href', '/path')
expect(element).toHaveClass('active')
expect(element).toHaveValue('input value')

// 函数调用断言
expect(fn).toHaveBeenCalled()
expect(fn).toHaveBeenCalledTimes(2)
expect(fn).toHaveBeenCalledWith(arg1, arg2)
expect(fn).toHaveBeenLastCalledWith(arg)

// 异步断言
await expect(promise).resolves.toEqual(value)
await expect(promise).rejects.toThrow('error message')

// 快照
expect(component).toMatchSnapshot()
expect(component).toMatchInlineSnapshot(`"..."`)
```
