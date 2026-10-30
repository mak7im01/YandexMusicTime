import { defineAddonSettings, SettingType } from '@pulsesync/addon-sdk'

export const settings = defineAddonSettings([
    {
        title: 'Настройки отображения',
        items: {
            showTimer: {
                type: SettingType.BOOLEAN,
                name: 'Показывать время',
                description: 'Отображать время прослушивания на странице',
                default: true,
            },
            showStreak: {
                type: SettingType.BOOLEAN,
                name: 'Показывать стрик',
                description:
                    'Серия ежедневных входов рядом с таймером. Пропуск дня начинает новую серию. Скрытие огонька не сбрасывает прогресс.',
                default: true,
            },
            streakFormat: {
                type: SettingType.SELECT,
                name: 'Формат отображения стрика',
                description: 'Текст с количеством дней подряд или огонёк с уровнем серии.',
                default: 'text',
                options: [
                    { value: 'text', label: 'Число' },
                    { value: 'flame', label: 'Огонёк' },
                ],
            },
            timerPosition: {
                type: SettingType.SELECT,
                name: 'Позиция времени',
                description: 'Выберите расположение времени на экране',
                default: 1,
                options: [
                    { value: 1, label: 'Вверху по центру' },
                    { value: 2, label: 'Верхний левый угол' },
                ],
            },
            timerStatType: {
                type: SettingType.SELECT,
                name: 'Что показывать в таймере',
                description: 'Выберите, какую статистику отображать на странице',
                default: 1,
                options: [
                    { value: 1, label: 'Прослушано всего' },
                    { value: 2, label: 'Прослушано за год' },
                    { value: 3, label: 'Прослушано за месяц' },
                    { value: 4, label: 'Прослушано за неделю' },
                    { value: 5, label: 'Прослушано за день' },
                    { value: 6, label: 'Прослушано в текущей сессии' },
                ],
            },
            showTimerLabel: {
                type: SettingType.BOOLEAN,
                name: 'Показывать подпись',
                description: 'Добавляет подпись к таймеру (например «За месяц:») и текст «Дней подряд:» к стрику',
                default: true,
            },
            timerColor: {
                type: SettingType.BOOLEAN,
                name: 'Статический цвет',
                description: 'Использовать статический цвет вместо динамического',
                default: false,
            },
            customColor: {
                type: SettingType.COLOR,
                name: 'Выбор цвета',
                description: 'Цвет таймера, работает только при включенном статическом цвете',
                default: '#ffffff',
            },
        },
    },
    {
        title: 'Дополнительно',
        items: {
            fontSize: {
                type: SettingType.NUMBER,
                name: 'Размер шрифта',
                description: 'Размер шрифта таймера в пикселях',
                default: 12,
                min: 12,
                max: 32,
                step: 2,
            },
            showSeconds: {
                type: SettingType.BOOLEAN,
                name: 'Показывать секунды',
                description: 'Отображать секунды в таймере',
                default: true,
            },
            showIcon: {
                type: SettingType.BOOLEAN,
                name: 'Показывать иконку',
                description: 'Отображать иконку 🎵 перед временем',
                default: false,
            },
            showNavbarButton: {
                type: SettingType.BOOLEAN,
                name: 'Показывать иконку статистики в навбаре',
                description: 'Показывать или скрывать кнопку «Статистика» в боковом меню',
                default: true,
            },
        },
    },
])
