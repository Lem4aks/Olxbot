
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';

const token = "";
const bot = new TelegramBot(token, { polling: true });

let currentIndex = 0;
let allOffers = [];
let userQuery = "";
let lastMessageId = null;

bot.on('message', async (msg) => {
    const text = msg.text;
    const chatid = msg.chat.id;

    if (text === '/start') {
        await bot.sendMessage(chatid, 'Напиши, что ты хочешь найти');
    } else if (text) {
        userQuery = text;

        if (lastMessageId) {
            try {
                await bot.deleteMessage(chatid, lastMessageId);
            } catch (error) {
                console.error('Error deleting message:', error);
            }
        }

        await bot.sendMessage(chatid, 'Поиск начат, подождите немного...');
        await fetchOffers(userQuery, chatid);
    }
});

async function fetchOffers(query, chatid) {
    const regex = createRegexFromQuery(query);

    currentIndex = 0;
    allOffers = [];

    try {
        let hasMoreOffers = true;

        while (hasMoreOffers) {
            const response = await fetch(`https://www.olx.ua/api/v1/offers?offset=${currentIndex * 10}&limit=10&query=${encodeURIComponent(query)}&filter_refiners=spell_checker&suggest_filters=true`);
            const data = await response.json();

            if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
                let offers = data.data;

                offers.forEach(offer => {
                    let url = offer.url;
                    let title = offer.title;
                    let priceValue = null;

                    if (!containsRelevantKeywords(title, regex)) {
                        return;
                    }

                    if (Array.isArray(offer.params)) {
                        offer.params.forEach(param => {
                            if (param.key === 'price' && param.value && param.value.value !== undefined && param.value.value > 0) {
                                priceValue = param.value.value;
                            }
                        });
                    }

                    if (priceValue !== null && priceValue > 0) {
                        allOffers.push({
                            url: url,
                            title: title,
                            priceValue: priceValue,
                        });
                    }
                });

                currentIndex += 1;
            } else {
                hasMoreOffers = false;
            }
        }

        console.log('All offers:', allOffers);

        await sendOfferMessage(chatid);

    } catch (error) {
        console.error('Error:', error);
        bot.sendMessage(chatid, 'An error occurred while fetching offers.');
    }
}

function createRegexFromQuery(query) {
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(escapedQuery, 'i');
}

function containsRelevantKeywords(title, regex) {
    return regex.test(title);
}

function calculateAveragePrice(offers) {
    if (offers.length === 0) {
        return null;
    }

    let filteredOffers = offers.filter(offer => offer.priceValue > 0);
    if (filteredOffers.length === 0) {
        return null;
    }

    let prices = filteredOffers.map(offer => offer.priceValue);
    let avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    return avgPrice;
}

function filterOffersBelowAverage(offers, avgPrice) {
    return offers.filter(offer => offer.priceValue > 0 && offer.priceValue < avgPrice);
}

function sortOffersByPrice(offers) {
    return offers.sort((a, b) => a.priceValue - b.priceValue);
}

async function sendOfferMessage(chatid) {
    const avgPrice = calculateAveragePrice(allOffers);

    if (avgPrice === null) {
        await bot.sendMessage(chatid, 'No valid prices found.');
        return;
    }

    const offersBelowAverage = filterOffersBelowAverage(allOffers, avgPrice);
    const sortedOffers = sortOffersByPrice(offersBelowAverage);

    if (sortedOffers.length > 0) {
        currentIndex = 0;
        const offer = sortedOffers[currentIndex];
        const message = `Title: ${offer.title}\nURL: ${offer.url}\nPrice: ${offer.priceValue}`;

        const keyboard = [];
        if (sortedOffers.length > 1) {
            keyboard.push([{ text: 'Previous', callback_data: 'prev' }, { text: 'Next', callback_data: 'next' }]);
        }
        const options = {
            reply_markup: {
                inline_keyboard: keyboard
            }
        };

        const sentMessage = await bot.sendMessage(chatid, message, options);
        lastMessageId = sentMessage.message_id;
    } else {
        await bot.sendMessage(chatid, 'No offers below the average price.');
    }
}

bot.on('callback_query', async (query) => {
    const chatid = query.message.chat.id;
    const action = query.data;

    if (action === 'next') {
        if (currentIndex < allOffers.length - 1) {
            currentIndex += 1;
        }
    } else if (action === 'prev') {
        if (currentIndex > 0) {
            currentIndex -= 1;
        }
    }

    const offer = allOffers[currentIndex];
    if (offer) {
        const message = `Title: ${offer.title}\nURL: ${offer.url}\nPrice: ${offer.priceValue}`;

        const keyboard = [];
        if (currentIndex > 0) {
            keyboard.push([{ text: 'Previous', callback_data: 'prev' }]);
        }
        if (currentIndex < allOffers.length - 1) {
            keyboard.push([{ text: 'Next', callback_data: 'next' }]);
        }

        const options = {
            reply_markup: {
                inline_keyboard: keyboard
            }
        };

        await bot.editMessageText(message, { chat_id: chatid, message_id: query.message.message_id, ...options });
    }
});
