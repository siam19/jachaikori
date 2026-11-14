
# Prothom Alo
Prothom Alo doesn't seem to have an archive page but it has a search page where you can define calendar date range and find all the articles for that day. 

url: https://www.prothomalo.com/search?sort=latest-published

The `#datepicker-input` element opens up a date range selector where you can define the date range. Entering dates changes the url.

url: https://www.prothomalo.com/search?published-after=1794506400000&published-before=1794679199999&sort=latest-published

Here I chose the dates 13 Nov 2026 - 14 Nov 2026

It also features a category selector at `#section-input`. Selecting a section changes the url. Here are the categories I'm interested in:

url(bangladesh): https://www.prothomalo.com/search?sort=latest-published&section-id=17533%2C17535%2C17536%2C17538%2C22321%2C22236

url(politics): https://www.prothomalo.com/search?sort=latest-published&section-id=22237

url(commerce): https://www.prothomalo.com/search?sort=latest-published&section-id=17552%2C17553%2C22324%2C22325%2C22326%2C26653%2C17556%2C17555%2C23382%2C23383%2C17560


At the bottom of the articles, there is a button `.load-more-content` with the label "আরও" that loads more content until there is no more.

You can ofcourse combine date range & section that leads to urls like this:
https://www.prothomalo.com/search?published-after=1794333600000&published-before=1794679199999&sort=latest-published&section-id=17533%2C17535%2C17536%2C17538%2C22321%2C22236


`.news_item_content` contains the headlines and relative publishing time.


# Bangladesh Protidin

Bangladesh Protidin's website does not have any archive pages as far as I know of. It also has a lot of distracting news articles on the right. We can select by category and it shows all the articles of that category in a paginated list. Here are the categories I'm interested in:

url: https://www.bd-pratidin.com/national
url: https://www.bd-pratidin.com/minister-speech
url: https://www.bd-pratidin.com/economy

The UI has this quirk that in each page, one article gets displayed differently as a big card (XPath: /html/body/main/section/div[3]/div[1]/div[1]).

Then there are two divs `.more` and `.more2` that house the article headlines and URL.
Here are the article card XPath from each div.
Xpath(more): /html/body/main/section/div[3]/div[1]/div[2]/div[3]/div 
Xpath(more2): /html/body/main/section/div[3]/div[1]/div[3]/div[10]/div 


Then at the bottom we have `.pagination` that li of all the pages in that category. 
You can change the pagination by adding url param "page"

url: https://www.bd-pratidin.com/economy?page=3

One problem we have with Bangladesh protidin is that their article cards do not contain any information about the publishing date on it. So every once in a while we will have to visit an articles page and find the publishing date (Xpath=/html/body/main/section/div[2]/div[1]/div[1]/div[1]) in article page. It should have the text in this format="প্রকাশ: ০৪:৩২, মঙ্গলবার, ১০ নভেম্বর, ২০২৬"

We will need to check the date because we don't wanna be scraping beyond our cutoff date.


# Jugantor  
Jugantor has an archive page available.

url: https://www.jugantor.com/archive

There is no category selector but you can select a date using from time picker (Xpath=/html/body/main/div[1]/div/div/div[2]/div/div[1]/form/div/div/div/div[2]) and end time picker (Xpath=/html/body/main/div[1]/div/div/div[2]/div/div[1]/form/div/div/div/div[3]/div). After hitting the submit button, the url changes:

url: https://www.jugantor.com/archive?search=yes&headline=&dateFrom=2026-11-13+05%3A10&dateTo=2026-11-14+00%3A25&newsType=

You can open the link in new browser and the date/filtering will be automatically loaded.

You can click Next button at the bottom (Xpath=/html/body/main/div[1]/div/div/div[2]/div/div[3]/div/nav/a) and you will be incremented to next page in url.

url: https://www.jugantor.com/archive?page=3
url: https://www.jugantor.com/archive?search=yes&dateFrom=2026-11-13%2005%3A10&dateTo=2026-11-14%2000%3A25&page=2


# Kaler Kantho

Kaler Kantho doesn't seem to have any archives that I could find. But it has categories that can keep loading up news articles. Here are the categories I am interested in:

url: https://www.kalerkantho.com/online/national
url: https://www.kalerkantho.com/online/country-news
url: https://www.kalerkantho.com/online/Politics
url: https://www.kalerkantho.com/online/Court
url: https://www.kalerkantho.com/online/business


Here is the structure of each category page:

At the beginning there is a large section highlighting the most read news in that category (probably today). It's located at (Xpath=/html/body/main/section/div/div[3]/div[1]/div[1]) but doesn't have a publishing date on it. All the rest of the articles do still have them. Then there are 4 selected news articles (probably ranked by most trending) inside (Xpath=/html/body/main/section/div/div[3]/div[1]/div[2])

Then we have the loadable articles section in (/html/body/main/section/div/div[7]/div[1]) that contains a list of articles. At the bottom you can find the load more button (XPath=/html/body/main/section/div/div[7]/div[1]/div[17]/div[2]/button) with the label "আরও সংবাদ". Clicking on in loads more divs into loadable articles section.


# Ittefaq

Ittefaq has an archive page where you can select a day an it shows all the news from that day.

url: https://www.ittefaq.com.bd/archive/2026-11-12

Changing the url to a date loads that days news but its paginated.
Clicking the button inside `.load_more_status` labeled "আরও" loads more articles from the day.

The archive contains news from all categories (see `.category`) and we will crawl all of that.

# The Daily Star

I couldn't find any archives for TDS, so we will have to scrape category pages. Interested categories: 
url: https://www.thedailystar.net/news/politics
url: https://www.thedailystar.net/news/governance
url: https://www.thedailystar.net/news/crime-justice
url: https://www.thedailystar.net/news/accidents-and-fires
url: https://www.thedailystar.net/business/economy
url: https://www.thedailystar.net/business/startups


Each category page has a highlighted list of around 10 articles in (Xpath=/html/body/div[2]/main/div/div/div/div/div/div[1]/div/div/div/div/div/div[2]). These are probably preselected by the editors. Then we have `.view-content` section (XPath=/html/body/div[2]/main/div/div/div/div/div/div[2]/div/div/div/div/div/div[1]/div/div/div) that holds a list of articles. At the bottom we have `li.pager__item` with the label "Show More". Clicking on it populates `.view-content` with more article divs.


# The Business Standard:
url: https://www.tbsnews.net/archive/2026/10/30
- /archive/<year>/<month>/<date> shows all the news published that day.

# bdnews24 (bangla):
BDNews24 Does have an archive that you can query. You can filter articles between date ranges.

url: https://bangla.bdnews24.com/archive?published_after=2026-01-01&published_before=2026-02-19

You can select which category you want to show:

url(politics): https://bangla.bdnews24.com/archive?section_id=37846
url(bangaldesh): https://bangla.bdnews24.com/archive?section_id=39002
url(economics): https://bangla.bdnews24.com/archive?section_id=39123
url(commerce): https://bangla.bdnews24.com/archive?section_id=39367
url(court): https://bangla.bdnews24.com/archive?section_id=107363


You can combine this with date range url params as well:
url: https://bangla.bdnews24.com/archive?section_id=39002&published_after=2026-11-12&published_before=2026-11-14

The articles are divs inside `.data-wrapper` . Clicking the button (Xpath=/html/body/main/section[2]/div/div[2]/button) with the label "আরও" populates the `.data-wrapper` with more divs.
